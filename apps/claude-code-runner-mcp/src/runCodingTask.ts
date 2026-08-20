import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { finishTaskRun, insertTaskRun } from './db.js';
import { cleanupClone, shallowClone } from './git.js';
import { logger } from './logger.js';
import { runTaskContainer } from './docker/runContainer.js';
import { buildPrompt } from './prompt.js';
import { checkSessionValid } from './session.js';
import type { RunCodingTaskInput, RunCodingTaskOutput } from './types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_SECONDS = 1800;

export interface RunCodingTaskDeps {
  githubToken?: string;
  claudeCodeOauthToken: string;
  /** Ver docs/hermes/spec.md §3.4. Sin valor, se usa la red por defecto de Docker (solo pensado para desarrollo/tests locales). */
  networkMode?: string;
  httpProxyUrl?: string;
  /** Prefijo de clonado, sobreescribible en tests para apuntar a un repo local en vez de github.com. */
  gitBaseUrl?: string;
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
    ...(input.brainContext !== undefined ? { brainContext: input.brainContext } : {}),
  });

  // Paso 1 del flujo (docs/hermes/spec.md §3.2): comprobar la sesión ANTES
  // de clonar o lanzar el contenedor de la tarea. Si no es válida, no se
  // llega a hacer `docker run` para la tarea real.
  const sessionCheck = await checkSessionValid(deps.claudeCodeOauthToken);
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
    });

    const { stdout: baseShaRaw } = await execFileAsync('git', [
      '-C',
      workspaceDir,
      'rev-parse',
      'HEAD',
    ]);
    const baseSha = baseShaRaw.trim();

    await writeFile(join(workspaceDir, 'prompt.md'), buildPrompt(input));

    const taskBranchName = `hermes/${Date.now()}-${slugify(input.taskTitle)}`;

    const containerResult = await runTaskContainer({
      workspaceDir,
      claudeCodeOauthToken: deps.claudeCodeOauthToken,
      ...(deps.githubToken !== undefined ? { githubToken: deps.githubToken } : {}),
      taskBranchName,
      timeoutSeconds,
      ...(deps.networkMode !== undefined ? { networkMode: deps.networkMode } : {}),
      ...(deps.httpProxyUrl !== undefined ? { httpProxyUrl: deps.httpProxyUrl } : {}),
    });

    if (containerResult.timedOut) {
      const output: RunCodingTaskOutput = {
        status: 'timed_out',
        summary: `La tarea excedió el timeout de ${timeoutSeconds}s.`,
      };
      await finishTaskRun(taskRunId, output.status, output);
      return output;
    }

    const branchName = await currentBranch(workspaceDir).catch(() => undefined);
    const commitShas = branchName
      ? await commitsSinceBase(workspaceDir, baseSha).catch(() => [])
      : [];

    const containerStatus = containerResult.result?.status;
    const hasCommits = commitShas.length > 0;

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

    if (status === 'success' && deps.githubToken && branchName) {
      await pushBranch(workspaceDir, input.repo, branchName, deps.githubToken);
    }

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
  const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);
  return stdout.trim();
}

async function commitsSinceBase(dir: string, baseSha: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', [
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
  await execFileAsync('git', ['-C', dir, 'push', url, `HEAD:${branch}`]);
}

export { slugify };
