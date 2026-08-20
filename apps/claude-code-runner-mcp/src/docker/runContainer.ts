import Docker from 'dockerode';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../logger.js';
import type { ContainerResult } from '../types.js';

export const RUNNER_IMAGE =
  process.env['CLAUDE_CODE_RUNNER_IMAGE'] ?? 'claude-code-runner-image:local';

export interface RunContainerOptions {
  workspaceDir: string;
  claudeCodeOauthToken: string;
  githubToken?: string;
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

  const env = [
    `CLAUDE_CODE_OAUTH_TOKEN=${options.claudeCodeOauthToken}`,
    `TASK_BRANCH_NAME=${options.taskBranchName}`,
  ];
  if (options.githubToken) {
    env.push(`GITHUB_TOKEN=${options.githubToken}`);
  }
  if (options.httpProxyUrl) {
    env.push(`HTTP_PROXY=${options.httpProxyUrl}`, `HTTPS_PROXY=${options.httpProxyUrl}`);
  }

  const container = await docker.createContainer({
    Image: RUNNER_IMAGE,
    Env: env,
    // El bind mount hereda los permisos del propietario del directorio en el
    // host; forzamos el mismo UID/GID dentro del contenedor para que el
    // usuario no-root de la imagen pueda escribir en /workspace.
    User:
      typeof process.getuid === 'function'
        ? `${process.getuid()}:${process.getgid?.() ?? 0}`
        : undefined,
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
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), timeoutMs);
    });

    const outcome = await Promise.race([waitPromise, timeoutPromise]);
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
