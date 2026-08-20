import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ShallowCloneOptions {
  /** owner/repo, o una URL git completa (usado en tests con repos locales) */
  repo: string;
  baseBranch?: string;
  /** prefijo de github.com por defecto; sobreescribible para tests con repos locales */
  baseUrl?: string;
  /** Necesario para clonar repos privados (host-side, antes de que exista ningún checkout). */
  githubToken?: string;
}

/**
 * Clona superficialmente (`--depth 1`) el repo indicado a un directorio
 * temporal. El caller es responsable de llamar a `cleanupClone` al terminar.
 */
export async function shallowClone(options: ShallowCloneOptions): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-code-runner-'));
  let url: string;
  if (options.repo.includes('://') || options.repo.startsWith('/')) {
    url = options.repo;
  } else {
    const base = options.baseUrl ?? 'https://github.com';
    const authedBase = options.githubToken
      ? base.replace('https://', `https://x-access-token:${options.githubToken}@`)
      : base;
    url = `${authedBase}/${options.repo}.git`;
  }

  const args = ['clone', '--depth', '1'];
  if (options.baseBranch) {
    args.push('--branch', options.baseBranch);
  }
  args.push(url, dir);

  try {
    await execFileAsync('git', args);
  } catch (err) {
    // El error de execFile puede incluir la URL completa (con el token
    // embebido) en `cmd`/`message`/`stack` — nunca debe propagarse tal cual
    // a los logs. Ver docs/hermes/spec.md §6 (gestión de secretos).
    throw new Error(
      `git clone falló: ${redactSecrets(err instanceof Error ? err.message : String(err))}`,
    );
  }
  return dir;
}

function redactSecrets(message: string): string {
  return message.replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');
}

export async function cleanupClone(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
