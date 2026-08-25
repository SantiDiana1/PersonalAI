import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { finishTaskRun, insertTaskRun } from './db.js';
import { cleanupClone, shallowClone } from './git.js';
import { logger } from './logger.js';
import { runClaudeCommandContainer } from './docker/runContainer.js';
import { ensureIsolation, type IsolationSetup } from './docker/network.js';
import { buildCommandPrompt } from './prompt.js';
import { createWorkspaceDir } from './workspace.js';
import { defaultRateLimiter, type RateLimiter } from './rateLimit.js';
import { checkSessionValid } from './session.js';
import {
  ALLOWED_SLASH_COMMANDS,
  type RunClaudeCommandInput,
  type RunClaudeCommandOutput,
} from './types.js';

const DEFAULT_TIMEOUT_SECONDS = 900;

export interface RunClaudeCommandDeps {
  claudeCodeOauthToken: string;
  /** Solo si `input.repo` viene informado — el clonado es de solo lectura, para dar contexto (mismo mecanismo que run_coding_task, sin push). */
  githubToken?: string;
  networkMode?: string;
  httpProxyUrl?: string;
  disableIsolation?: boolean;
  gitBaseUrl?: string;
  rateLimiter?: RateLimiter;
}

async function resolveIsolation(deps: RunClaudeCommandDeps): Promise<Partial<IsolationSetup>> {
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

/** Ver types.ts::ALLOWED_SLASH_COMMANDS — rechaza cualquier comando fuera de la allowlist antes de tocar Docker. */
export function isAllowedSlashCommand(
  value: string,
): value is (typeof ALLOWED_SLASH_COMMANDS)[number] {
  return (ALLOWED_SLASH_COMMANDS as readonly string[]).includes(value);
}

/**
 * Orquesta `run_claude_command` de principio a fin — ver docs/hermes/spec.md
 * §3.7 y la nota de diseño en types.ts (Fase 8, US-8.2). A diferencia de
 * `runCodingTask`, no clona por necesidad (solo si `input.repo` da contexto),
 * no crea rama, no hace push, y el entregable es `htmlContent`, no un diff.
 */
export async function runClaudeCommand(
  input: RunClaudeCommandInput,
  deps: RunClaudeCommandDeps,
): Promise<RunClaudeCommandOutput> {
  if (!isAllowedSlashCommand(input.slashCommand)) {
    const output: RunClaudeCommandOutput = {
      status: 'failed',
      summary: `Comando no permitido: "${input.slashCommand}". Allowlist: ${ALLOWED_SLASH_COMMANDS.join(', ')}.`,
    };
    return output;
  }

  const timeoutSeconds = input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const taskRunId = await insertTaskRun({
    repo: input.repo ?? 'n/a',
    taskTitle: `${input.slashCommand} ${input.prompt}`.slice(0, 200),
    ...(input.brainContext !== undefined ? { brainContext: input.brainContext } : {}),
  });

  const isolation = await resolveIsolation(deps);

  const sessionCheck = await checkSessionValid(deps.claudeCodeOauthToken, isolation);
  if (!sessionCheck.valid) {
    const output: RunClaudeCommandOutput = {
      status: 'needs_human_input',
      summary: `Sesión de Claude Code no válida (${sessionCheck.reason}): ${sessionCheck.detail}`,
    };
    await finishTaskRun(taskRunId, output.status, output);
    return output;
  }

  let workspaceDir: string | undefined;
  try {
    workspaceDir = input.repo
      ? await shallowClone({
          repo: input.repo,
          ...(deps.gitBaseUrl !== undefined ? { baseUrl: deps.gitBaseUrl } : {}),
          ...(deps.githubToken !== undefined ? { githubToken: deps.githubToken } : {}),
        })
      : await createWorkspaceDir();

    await writeFile(join(workspaceDir, 'command-prompt.md'), buildCommandPrompt(input));

    const rateLimiter = deps.rateLimiter ?? defaultRateLimiter;

    // Misma cuota compartida que run_coding_task — ver docs/hermes/spec.md §6.
    if (!rateLimiter.tryAcquire()) {
      const output: RunClaudeCommandOutput = {
        status: 'needs_human_input',
        summary:
          'Límite de tareas concurrentes/por hora alcanzado — la tarea se rechaza en vez de lanzar ' +
          'un contenedor adicional. Reintenta más tarde.',
      };
      await finishTaskRun(taskRunId, output.status, output);
      return output;
    }

    let containerResult;
    try {
      containerResult = await runClaudeCommandContainer({
        workspaceDir,
        claudeCodeOauthToken: deps.claudeCodeOauthToken,
        timeoutSeconds,
        ...isolation,
      });
    } finally {
      rateLimiter.release();
    }

    if (containerResult.timedOut) {
      const output: RunClaudeCommandOutput = {
        status: 'timed_out',
        summary: `El comando excedió el timeout de ${timeoutSeconds}s.`,
      };
      await finishTaskRun(taskRunId, output.status, output);
      return output;
    }

    let output: RunClaudeCommandOutput;
    if (!containerResult.result) {
      output = {
        status: 'failed',
        summary: `El contenedor terminó (exit code ${String(containerResult.exitCode)}) sin escribir command-result.json.`,
      };
    } else if (containerResult.result.status === 'success' && !containerResult.htmlContent) {
      output = {
        status: 'failed',
        summary: 'Claude Code reportó éxito pero no generó artifact-output.html.',
      };
    } else {
      output = {
        status: containerResult.result.status,
        summary: containerResult.result.summary,
        ...(containerResult.htmlContent ? { htmlContent: containerResult.htmlContent } : {}),
      };
    }

    await finishTaskRun(taskRunId, output.status, output);
    return output;
  } catch (err) {
    logger.error(
      { err, slashCommand: input.slashCommand },
      'run_claude_command falló de forma inesperada',
    );
    const output: RunClaudeCommandOutput = {
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
