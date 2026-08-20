import Docker from 'dockerode';
import { RUNNER_IMAGE } from './docker/runContainer.js';
import { logger } from './logger.js';

export type SessionCheckResult =
  { valid: true } | { valid: false; reason: 'expired' | 'revoked' | 'unknown'; detail: string };

const CHECK_TIMEOUT_MS = 30_000;

/**
 * Clasifica el resultado de `claude -p "..."` en la comprobación de sesión.
 * El CLI no distingue con un código de salida propio "expirado" de
 * "revocado", así que buscamos el patrón más probable en el mensaje de
 * error para dar contexto útil al Operador — ver docs/hermes/spec.md §3.3.
 * Extraída como función pura para poder testear la heurística sin Docker.
 */
export function classifySessionCheck(exitCode: number, logs: string): SessionCheckResult {
  const lower = logs.toLowerCase();

  if (exitCode === 0 && lower.includes('ok')) {
    return { valid: true };
  }

  if (/expired|token.*invalid|please log in|re-?authenticate/.test(lower)) {
    return {
      valid: false,
      reason: 'expired',
      detail: 'Sesión expirada, requiere `claude setup-token` de nuevo en el host.',
    };
  }
  if (/revoked|forbidden|unauthorized|suspended/.test(lower)) {
    return {
      valid: false,
      reason: 'revoked',
      detail:
        'Sesión rechazada por el servidor — posible revocación, revisar estado de la cuenta antes de reintentar.',
    };
  }

  logger.warn({ exitCode, logs }, 'comprobación de sesión falló con un motivo no reconocido');
  return {
    valid: false,
    reason: 'unknown',
    detail: `claude salió con código ${String(exitCode)}: ${logs.slice(0, 300)}`,
  };
}

/**
 * Comprueba que el token de la sesión de Claude Code (`hermes-claude-auth`)
 * sigue siendo válido, lanzando un contenedor efímero de comprobación con un
 * prompt corto — ver docs/hermes/spec.md §3.2 paso 1 y §3.3.
 *
 * Se hace en un contenedor (no en el host) para no requerir el CLI de Claude
 * Code instalado fuera de Docker y para reusar exactamente el mismo camino
 * (imagen, red) que usará la tarea real.
 */
export async function checkSessionValid(claudeCodeOauthToken: string): Promise<SessionCheckResult> {
  const docker = new Docker();
  const container = await docker.createContainer({
    Image: RUNNER_IMAGE,
    Entrypoint: ['claude'],
    Cmd: ['-p', 'Reply with exactly the single word: OK', '--output-format', 'text'],
    Env: [`CLAUDE_CODE_OAUTH_TOKEN=${claudeCodeOauthToken}`],
    User:
      typeof process.getuid === 'function'
        ? `${process.getuid()}:${process.getgid?.() ?? 0}`
        : undefined,
    HostConfig: { AutoRemove: false },
  });

  try {
    await container.start();

    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), CHECK_TIMEOUT_MS);
    });
    const outcome = await Promise.race([container.wait(), timeoutPromise]);

    if (outcome === 'timeout') {
      await container.stop({ t: 2 }).catch(() => undefined);
      return {
        valid: false,
        reason: 'unknown',
        detail: 'La comprobación de sesión no respondió a tiempo.',
      };
    }

    const exitCode = (outcome as { StatusCode: number }).StatusCode;
    const logsBuffer = await container.logs({ stdout: true, stderr: true, tail: 50 });
    const logs = Buffer.isBuffer(logsBuffer) ? logsBuffer.toString('utf-8') : String(logsBuffer);

    return classifySessionCheck(exitCode, logs);
  } finally {
    await container.remove({ force: true }).catch((err: unknown) => {
      logger.error({ err }, 'fallo al eliminar el contenedor de comprobación de sesión');
    });
  }
}
