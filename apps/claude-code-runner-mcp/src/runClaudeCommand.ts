import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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
  /**
   * Directorio persistente, montado en la MISMA ruta en este contenedor y en
   * el de hermes-agent (mismo patrón que `CLAUDE_CODE_RUNNER_WORKSPACE_ROOT`
   * — ver docs/hermes/spec.md §3.6), donde se deja una copia de
   * `artifact-output.html` para que el gateway de Telegram pueda mandarla
   * como adjunto real (`MEDIA:<ruta>`) en vez de como texto. Sin configurar,
   * `htmlFilePath` queda ausente y el Skill cae al fallback de pegar
   * `htmlContent` como texto — sigue funcionando, peor UX.
   */
  artifactsDir?: string;
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

/**
 * Copia `htmlContent` a un fichero en `artifactsDir` con nombre único, y
 * devuelve la ruta — ver RunClaudeCommandDeps::artifactsDir para el porqué
 * (entrega como adjunto real de Telegram vía `MEDIA:`, no como texto).
 *
 * Sin `artifactsDir` configurado (deployment que no lo montó todavía), no
 * escribe nada y devuelve `undefined` — degradación esperada, no un error:
 * `runClaudeCommand` sigue devolviendo `htmlContent` de todos modos.
 *
 * Retención: deliberadamente NO limpia ficheros antiguos aquí — a
 * diferencia del workspace efímero (`cleanupClone`), este directorio debe
 * sobrevivir el tiempo suficiente para que el gateway de Telegram, en un
 * proceso/turno completamente distinto, llegue a leerlo. Limpiarlo (p. ej.
 * con una tarea de cron externa que borre lo más antiguo de N días) queda
 * como tarea operativa pendiente, documentada, no bloqueante.
 */
async function persistArtifact(
  htmlContent: string,
  artifactsDir: string | undefined,
  slashCommand: string,
): Promise<string | undefined> {
  if (!artifactsDir) return undefined;
  await mkdir(artifactsDir, { recursive: true });
  const safeCommand = slashCommand.replace(/[^a-z0-9]+/gi, '');
  const fileName = `${Date.now()}-${safeCommand}-${randomUUID().slice(0, 8)}.html`;
  const filePath = join(artifactsDir, fileName);
  await writeFile(filePath, htmlContent);
  return filePath;
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
    tool: 'run_claude_command',
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
      const htmlFilePath = containerResult.htmlContent
        ? await persistArtifact(containerResult.htmlContent, deps.artifactsDir, input.slashCommand)
        : undefined;
      output = {
        status: containerResult.result.status,
        summary: containerResult.result.summary,
        ...(containerResult.htmlContent ? { htmlContent: containerResult.htmlContent } : {}),
        ...(htmlFilePath ? { htmlFilePath } : {}),
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
