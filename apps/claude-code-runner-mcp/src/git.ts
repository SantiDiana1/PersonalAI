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
}

/**
 * Clona superficialmente (`--depth 1`) el repo indicado a un directorio
 * temporal. El caller es responsable de llamar a `cleanupClone` al terminar.
 */
export async function shallowClone(options: ShallowCloneOptions): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-code-runner-'));
  const url =
    options.repo.includes('://') || options.repo.startsWith('/')
      ? options.repo
      : `${options.baseUrl ?? 'https://github.com'}/${options.repo}.git`;

  const args = ['clone', '--depth', '1'];
  if (options.baseBranch) {
    args.push('--branch', options.baseBranch);
  }
  args.push(url, dir);

  await execFileAsync('git', args);
  return dir;
}

export async function cleanupClone(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
