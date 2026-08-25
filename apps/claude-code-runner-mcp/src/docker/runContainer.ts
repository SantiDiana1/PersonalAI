import Docker from 'dockerode';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../logger.js';
import { resolveTaskUser, taskUserSpec } from '../taskUser.js';
import type { ContainerCommandResult, ContainerResult } from '../types.js';
import { chownWorkspace } from '../workspace.js';

export const RUNNER_IMAGE =
  process.env['CLAUDE_CODE_RUNNER_IMAGE'] ?? 'claude-code-runner-image:local';

export interface RunContainerOptions {
  workspaceDir: string;
  claudeCodeOauthToken: string;
  taskBranchName: string;
  timeoutSeconds: number;
  /** Ver docs/hermes/spec.md §3.4 — red restringida a una allowlist. Sin valor -> red por defecto de Docker (solo para tests locales, nunca en producción). */
  networkMode?: string;
  httpProxyUrl?: string;
}

export interface RunContainerResult {
  timedOut: boolean;
  exitCode: number | null;
  logs: string;
  result: ContainerResult | null;
}

/**
 * Lanza un contenedor efímero a partir de RUNNER_IMAGE, espera a que termine
 * (o hace timeout), y SIEMPRE lo destruye (`docker rm -f`) al salir de esta
 * función, tanto en éxito como en fallo — docs/hermes/spec.md §3.2 paso 8.
 *
 * Nunca monta el socket de Docker del host (`/var/run/docker.sock`): esta es
 * la única pieza del sistema con acceso a él, y ese acceso no se propaga al
 * contenedor de la tarea — ver §3.4.
 */
export async function runTaskContainer(options: RunContainerOptions): Promise<RunContainerResult> {
  const docker = new Docker();

  // DELIBERADAMENTE sin GITHUB_TOKEN (SEC-6.1 / SEC-5.6).
  //
  // El contenedor efímero no necesita credenciales de GitHub: el repo ya está
  // clonado en /workspace y quien empuja la rama al terminar es el runner
  // (`pushBranch`), no la tarea. Abrir el PR tampoco es cosa suya — eso lo hace
  // el Skill vía GitHub MCP (docs/hermes/spec.md §3.2 paso 9).
  //
  // Esto no es teórico: con un GITHUB_TOKEN presente se observó a Claude Code
  // crear su propia rama, empujarla y abrir un PR por su cuenta, saltándose el
  // flujo y dejando el `taskBranchName` sin commits. Pedirlo por prompt no
  // basta; sin credencial no puede hacerlo, punto.
  const env = [
    `CLAUDE_CODE_OAUTH_TOKEN=${options.claudeCodeOauthToken}`,
    `TASK_BRANCH_NAME=${options.taskBranchName}`,
  ];
  if (options.httpProxyUrl) {
    env.push(`HTTP_PROXY=${options.httpProxyUrl}`, `HTTPS_PROXY=${options.httpProxyUrl}`);
  }

  // El contenedor efímero corre como usuario no-root, así que el checkout y el
  // prompt.md —creados por este proceso, que en despliegue es root— tienen que
  // cambiar de propietario o la tarea no podrá ni commitear ni escribir
  // result.json. No-op cuando el runner no corre como root.
  const taskUser = resolveTaskUser();
  await chownWorkspace(options.workspaceDir, taskUser.uid, taskUser.gid);

  const container = await docker.createContainer({
    Image: RUNNER_IMAGE,
    Env: env,
    // Usuario NO-root, obligatoriamente: el CLI de Claude Code rechaza
    // --dangerously-skip-permissions con privilegios de root. Ver taskUser.ts.
    // El workspace se ha puesto a nombre de este usuario justo arriba.
    User: taskUserSpec(taskUser),
    HostConfig: {
      Binds: [`${options.workspaceDir}:/workspace`],
      NetworkMode: options.networkMode,
      // Nunca: Binds con /var/run/docker.sock, Privileged, CapAdd docker-relacionadas.
      AutoRemove: false, // lo removemos explícitamente en el finally para poder leer logs primero
      Memory: 2 * 1024 * 1024 * 1024,
      NanoCpus: 2_000_000_000,
    },
    WorkingDir: '/workspace',
  });

  let timedOut = false;
  try {
    await container.start();

    const timeoutMs = options.timeoutSeconds * 1000;
    const waitPromise = container.wait();
    let timeoutHandle!: NodeJS.Timeout;
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs);
    });

    const outcome = await Promise.race([waitPromise, timeoutPromise]);
    clearTimeout(timeoutHandle);
    let exitCode: number | null = null;
    if (outcome === 'timeout') {
      timedOut = true;
      logger.warn(
        { workspaceDir: options.workspaceDir },
        'contenedor de tarea excedió el timeout, forzando parada',
      );
      await container.stop({ t: 5 }).catch(() => undefined);
    } else {
      exitCode = (outcome as { StatusCode: number }).StatusCode;
    }

    const logsBuffer = await container.logs({ stdout: true, stderr: true, tail: 500 });
    const logs = Buffer.isBuffer(logsBuffer) ? logsBuffer.toString('utf-8') : String(logsBuffer);

    const result = await readResultJson(options.workspaceDir);

    return { timedOut, exitCode, logs, result };
  } finally {
    await container.remove({ force: true }).catch((err: unknown) => {
      logger.error(
        { err },
        'fallo al eliminar el contenedor de tarea — posible contenedor huérfano',
      );
    });
  }
}

async function readResultJson(workspaceDir: string): Promise<ContainerResult | null> {
  try {
    const raw = await readFile(join(workspaceDir, 'result.json'), 'utf-8');
    return JSON.parse(raw) as ContainerResult;
  } catch {
    return null;
  }
}

export interface RunCommandContainerOptions {
  workspaceDir: string;
  claudeCodeOauthToken: string;
  timeoutSeconds: number;
  networkMode?: string;
  httpProxyUrl?: string;
}

export interface RunCommandContainerResult {
  timedOut: boolean;
  exitCode: number | null;
  logs: string;
  result: ContainerCommandResult | null;
  /** Contenido de /workspace/artifact-output.html si el comando lo generó — ver prompt.ts::buildCommandPrompt. */
  htmlContent: string | null;
}

/**
 * Variante de `runTaskContainer` para `run_claude_command` (Fase 8, US-8.2):
 * mismo runner/imagen/aislamiento, pero sin `taskBranchName` (no hay rama que
 * crear — el entrypoint distingue el modo por la presencia de
 * `command-prompt.md`, ver docker/runner/entrypoint.sh) y leyendo
 * `command-result.json` + `artifact-output.html` en vez de `result.json`.
 */
export async function runClaudeCommandContainer(
  options: RunCommandContainerOptions,
): Promise<RunCommandContainerResult> {
  const docker = new Docker();

  // Mismas razones que en runTaskContainer: sin GITHUB_TOKEN, esta tool no
  // hace commits ni PRs, así que no hace falta ni siquiera por descuido.
  const env = [`CLAUDE_CODE_OAUTH_TOKEN=${options.claudeCodeOauthToken}`];
  if (options.httpProxyUrl) {
    env.push(`HTTP_PROXY=${options.httpProxyUrl}`, `HTTPS_PROXY=${options.httpProxyUrl}`);
  }

  const taskUser = resolveTaskUser();
  await chownWorkspace(options.workspaceDir, taskUser.uid, taskUser.gid);

  const container = await docker.createContainer({
    Image: RUNNER_IMAGE,
    Env: env,
    User: taskUserSpec(taskUser),
    HostConfig: {
      Binds: [`${options.workspaceDir}:/workspace`],
      NetworkMode: options.networkMode,
      AutoRemove: false,
      Memory: 2 * 1024 * 1024 * 1024,
      NanoCpus: 2_000_000_000,
    },
    WorkingDir: '/workspace',
  });

  let timedOut = false;
  try {
    await container.start();

    const timeoutMs = options.timeoutSeconds * 1000;
    const waitPromise = container.wait();
    let timeoutHandle!: NodeJS.Timeout;
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs);
    });

    const outcome = await Promise.race([waitPromise, timeoutPromise]);
    clearTimeout(timeoutHandle);
    let exitCode: number | null = null;
    if (outcome === 'timeout') {
      timedOut = true;
      logger.warn(
        { workspaceDir: options.workspaceDir },
        'contenedor de run_claude_command excedió el timeout, forzando parada',
      );
      await container.stop({ t: 5 }).catch(() => undefined);
    } else {
      exitCode = (outcome as { StatusCode: number }).StatusCode;
    }

    const logsBuffer = await container.logs({ stdout: true, stderr: true, tail: 500 });
    const logs = Buffer.isBuffer(logsBuffer) ? logsBuffer.toString('utf-8') : String(logsBuffer);

    const result = await readCommandResultJson(options.workspaceDir);
    const htmlContent = await readArtifactHtml(options.workspaceDir);

    return { timedOut, exitCode, logs, result, htmlContent };
  } finally {
    await container.remove({ force: true }).catch((err: unknown) => {
      logger.error(
        { err },
        'fallo al eliminar el contenedor de run_claude_command — posible contenedor huérfano',
      );
    });
  }
}

async function readCommandResultJson(workspaceDir: string): Promise<ContainerCommandResult | null> {
  try {
    const raw = await readFile(join(workspaceDir, 'command-result.json'), 'utf-8');
    return JSON.parse(raw) as ContainerCommandResult;
  } catch {
    return null;
  }
}

async function readArtifactHtml(workspaceDir: string): Promise<string | null> {
  try {
    return await readFile(join(workspaceDir, 'artifact-output.html'), 'utf-8');
  } catch {
    return null;
  }
}
