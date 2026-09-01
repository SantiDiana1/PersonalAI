import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { finishTaskRun, insertTaskRun } from './db.js';
import { cleanupClone, shallowClone } from './git.js';
import { logger } from './logger.js';
import { runTaskContainer } from './docker/runContainer.js';
import { ensureIsolation, type IsolationSetup } from './docker/network.js';
import { buildPrompt } from './prompt.js';
import { defaultRateLimiter, type RateLimiter } from './rateLimit.js';
import { checkSessionValid } from './session.js';
import type { RunCodingTaskInput, RunCodingTaskOutput } from './types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_SECONDS = 1800;

/**
 * `runTaskContainer` da la propiedad del workspace al usuario no-root del
 * contenedor efímero (ver `taskUser.ts`/`workspace.ts::chownWorkspace`), pero
 * este proceso corre como root (Dockerfile del propio runner). Sin este flag,
 * cualquier `git` lanzado aquí DESPUÉS de esa entrega de propiedad falla con
 * "detected dubious ownership" — el workspace es efímero y de un solo uso, así
 * que el riesgo que ese chequeo previene no aplica.
 */
const GIT_SAFE_DIRECTORY_ARGS = ['-c', 'safe.directory=*'];

export interface RunCodingTaskDeps {
  githubToken?: string;
  claudeCodeOauthToken: string;
  /** Ver docs/hermes/spec.md §3.4. Sin valor, se calcula automáticamente con `ensureIsolation()` (red interna + proxy allowlist). */
  networkMode?: string;
  httpProxyUrl?: string;
  /** SOLO para desarrollo/tests locales: desactiva el aislamiento de red y usa la red por defecto de Docker. Nunca en producción. */
  disableIsolation?: boolean;
  /** Prefijo de clonado, sobreescribible en tests para apuntar a un repo local en vez de github.com. */
  gitBaseUrl?: string;
  /** Ver docs/hermes/spec.md §6. Por defecto, el limitador compartido del proceso (defaultRateLimiter). */
  rateLimiter?: RateLimiter;
  /** No usado por run_coding_task — solo presente para que loadDeps() en mcpServer.ts sirva a las dos tools. Ver RunClaudeCommandDeps::artifactsDir. */
  artifactsDir?: string;
}

async function resolveIsolation(deps: RunCodingTaskDeps): Promise<Partial<IsolationSetup>> {
  if (deps.networkMode !== undefined || deps.httpProxyUrl !== undefined) {
    return {
      ...(deps.networkMode !== undefined ? { networkMode: deps.networkMode } : {}),
      ...(deps.httpProxyUrl !== undefined ? { httpProxyUrl: deps.httpProxyUrl } : {}),
    };
  }
  if (deps.disableIsolation) {
    logger.warn(
      'aislamiento de red desactivado (disableIsolation) — solo válido en desarrollo/tests',
    );
    return {};
  }
  return ensureIsolation();
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

/**
 * Orquesta `run_coding_task` de principio a fin — ver docs/hermes/spec.md §3.2.
 * La comprobación de sesión (paso 1, US-1.2) y el aislamiento de red completo
 * (paso 4-5, US-1.3) se añaden en runCodingTask.session.ts / se inyectan vía
 * `deps`; esta función asume que la sesión ya se comprobó antes de llamarla.
 */
export async function runCodingTask(
  input: RunCodingTaskInput,
  deps: RunCodingTaskDeps,
): Promise<RunCodingTaskOutput> {
  const timeoutSeconds = input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const taskRunId = await insertTaskRun({
    repo: input.repo,
    taskTitle: input.taskTitle,
    tool: 'run_coding_task',
    ...(input.brainContext !== undefined ? { brainContext: input.brainContext } : {}),
  });

  const isolation = await resolveIsolation(deps);

  // Paso 1 del flujo (docs/hermes/spec.md §3.2): comprobar la sesión ANTES
  // de clonar o lanzar el contenedor de la tarea. Si no es válida, no se
  // llega a hacer `docker run` para la tarea real.
  const sessionCheck = await checkSessionValid(deps.claudeCodeOauthToken, isolation);
  if (!sessionCheck.valid) {
    const output: RunCodingTaskOutput = {
      status: 'needs_human_input',
      summary: `Sesión de Claude Code no válida (${sessionCheck.reason}): ${sessionCheck.detail}`,
    };
    await finishTaskRun(taskRunId, output.status, output);
    return output;
  }

  let workspaceDir: string | undefined;
  try {
    workspaceDir = await shallowClone({
      repo: input.repo,
      ...(input.baseBranch !== undefined ? { baseBranch: input.baseBranch } : {}),
      ...(deps.gitBaseUrl !== undefined ? { baseUrl: deps.gitBaseUrl } : {}),
      ...(deps.githubToken !== undefined ? { githubToken: deps.githubToken } : {}),
    });

    const { stdout: baseShaRaw } = await execFileAsync('git', [
      ...GIT_SAFE_DIRECTORY_ARGS,
      '-C',
      workspaceDir,
      'rev-parse',
      'HEAD',
    ]);
    const baseSha = baseShaRaw.trim();

    await writeFile(join(workspaceDir, 'prompt.md'), buildPrompt(input));

    const taskBranchName = `hermes/${Date.now()}-${slugify(input.taskTitle)}`;
    const rateLimiter = deps.rateLimiter ?? defaultRateLimiter;

    // Ver docs/hermes/spec.md §6: límite de tareas concurrentes/por hora,
    // para no agotar la ventana de 5h/semanal compartida con hermes-agent.
    if (!rateLimiter.tryAcquire()) {
      const output: RunCodingTaskOutput = {
        status: 'needs_human_input',
        summary:
          'Límite de tareas concurrentes/por hora alcanzado — la tarea se rechaza en vez de lanzar ' +
          'un contenedor adicional. Reintenta más tarde o revisa CLAUDE_CODE_RUNNER_MAX_CONCURRENT/CLAUDE_CODE_RUNNER_MAX_PER_HOUR.',
      };
      await finishTaskRun(taskRunId, output.status, output);
      return output;
    }

    let containerResult;
    try {
      containerResult = await runTaskContainer({
        workspaceDir,
        claudeCodeOauthToken: deps.claudeCodeOauthToken,
        taskBranchName,
        timeoutSeconds,
        ...isolation,
      });
    } finally {
      rateLimiter.release();
    }

    const branchName = await currentBranch(workspaceDir).catch(() => undefined);
    const commitShas = branchName
      ? await commitsSinceBase(workspaceDir, baseSha).catch(() => [])
      : [];
    const hasCommits = commitShas.length > 0;

    // El workspace es efímero y se borra en el `finally` de más abajo pase lo
    // que pase, así que cualquier commit real se pierde para siempre salvo
    // que se empuje aquí ANTES de esa limpieza — sin importar si la tarea
    // terminó en éxito, timeout o needs_human_input. `needs_human_input` es
    // precisamente el caso que más necesita preservar el trabajo parcial para
    // que un humano lo revise, así que empujar solo en 'success' tiraba a la
    // basura justo el trabajo que hacía falta rescatar.
    if (hasCommits && branchName && deps.githubToken) {
      await pushBranch(workspaceDir, input.repo, branchName, deps.githubToken).catch((err) => {
        logger.error(
          { err, repo: input.repo, branchName },
          'no se pudo empujar la rama con el trabajo parcial antes de limpiar el workspace',
        );
      });
    }

    if (containerResult.timedOut) {
      const output: RunCodingTaskOutput = {
        status: 'timed_out',
        summary: `La tarea excedió el timeout de ${timeoutSeconds}s.`,
        ...(branchName !== undefined ? { branchName } : {}),
        ...(commitShas.length > 0 ? { commitShas } : {}),
      };
      await finishTaskRun(taskRunId, output.status, output);
      return output;
    }

    const containerStatus = containerResult.result?.status;

    let status: RunCodingTaskOutput['status'];
    let summary: string;
    if (!containerResult.result) {
      status = 'failed';
      summary = `El contenedor terminó (exit code ${String(containerResult.exitCode)}) sin escribir result.json.`;
    } else if (containerStatus === 'needs_human_input') {
      status = 'needs_human_input';
      summary = containerResult.result.summary;
    } else if (containerStatus === 'success' && hasCommits) {
      status = 'success';
      summary = containerResult.result.summary;
    } else if (containerStatus === 'success' && !hasCommits) {
      status = 'failed';
      summary = 'Claude Code reportó éxito pero no generó ningún commit.';
    } else {
      status = 'failed';
      summary = containerResult.result.summary;
    }

    const output: RunCodingTaskOutput = {
      status,
      summary,
      ...(branchName !== undefined ? { branchName } : {}),
      ...(commitShas.length > 0 ? { commitShas } : {}),
    };

    await finishTaskRun(taskRunId, status, output);
    return output;
  } catch (err) {
    logger.error({ err, repo: input.repo }, 'run_coding_task falló de forma inesperada');
    const output: RunCodingTaskOutput = {
      status: 'failed',
      summary: `Error interno: ${err instanceof Error ? err.message : String(err)}`,
    };
    await finishTaskRun(taskRunId, output.status, output);
    return output;
  } finally {
    if (workspaceDir) {
      await cleanupClone(workspaceDir);
    }
  }
}

async function currentBranch(dir: string): Promise<string> {
  const { stdout } = await execFileAsync('git', [
    ...GIT_SAFE_DIRECTORY_ARGS,
    '-C',
    dir,
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ]);
  return stdout.trim();
}

async function commitsSinceBase(dir: string, baseSha: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', [
    ...GIT_SAFE_DIRECTORY_ARGS,
    '-C',
    dir,
    'log',
    `${baseSha}..HEAD`,
    '--format=%H',
  ]);
  return stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function pushBranch(
  dir: string,
  repo: string,
  branch: string,
  githubToken: string,
): Promise<void> {
  const url = `https://x-access-token:${githubToken}@github.com/${repo}.git`;
  try {
    await execFileAsync('git', [
      ...GIT_SAFE_DIRECTORY_ARGS,
      '-C',
      dir,
      'push',
      url,
      `HEAD:${branch}`,
    ]);
  } catch (err) {
    // Ver git.ts:redactSecrets — el mismo riesgo aplica aquí: el error de
    // execFile puede incluir la URL con el token embebido.
    const message = (err instanceof Error ? err.message : String(err)).replace(
      /x-access-token:[^@]+@/g,
      'x-access-token:***@',
    );
    throw new Error(`git push falló: ${message}`);
  }
}

export { slugify };
