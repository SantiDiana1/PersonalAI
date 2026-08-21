import { chown, mkdir, mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Raíz bajo la que se crean los checkouts efímeros de cada tarea.
 *
 * Por qué es configurable en vez de usar `os.tmpdir()` a pelo: cuando el runner
 * corre dentro de un contenedor (despliegue de la Fase 2, ver
 * docs/hermes/spec.md §3.6), los bind mounts que pide al demonio de Docker se
 * resuelven **en el host**, no dentro del contenedor del runner. Si el checkout
 * viviera en el `/tmp` privado del contenedor, el demonio montaría una ruta del
 * host que no existe y el contenedor efímero recibiría un `/workspace` vacío —
 * fallando de forma confusa, sin error claro.
 *
 * La solución es montar una raíz dedicada en la MISMA ruta en host y en el
 * contenedor del runner, y apuntar aquí con `CLAUDE_CODE_RUNNER_WORKSPACE_ROOT`.
 * Así toda ruta que este proceso calcula es válida también para el demonio.
 *
 * Sin la variable (desarrollo local, runner en el host) se usa `os.tmpdir()`,
 * que es exactamente el comportamiento de la Fase 1.
 */
export function workspaceRoot(): string {
  const configured = process.env['CLAUDE_CODE_RUNNER_WORKSPACE_ROOT']?.trim();
  return configured && configured.length > 0 ? configured : tmpdir();
}

/**
 * Crea un directorio de trabajo efímero y único bajo `workspaceRoot()`.
 * El caller es responsable de limpiarlo (ver `cleanupClone`).
 */
export async function createWorkspaceDir(): Promise<string> {
  const root = workspaceRoot();
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, 'claude-code-runner-'));
}

/**
 * Da la propiedad del workspace (recursivamente) al usuario con el que correrá
 * el contenedor efímero.
 *
 * Necesario en el despliegue contenerizado: el runner corre como root, así que
 * el checkout y el `prompt.md` quedan siendo de root, pero el contenedor
 * efímero corre como usuario no-root (obligatorio — ver `taskUser.ts`) y no
 * podría escribir ahí: ni crear la rama, ni commitear, ni dejar `result.json`.
 *
 * No hace nada si el proceso no es root: no tendría permiso para cambiar el
 * propietario, y además significa que el workspace ya es del usuario correcto
 * (caso de la Fase 1, runner directamente en el host).
 */
export async function chownWorkspace(dir: string, uid: number, gid: number): Promise<void> {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (!isRoot) return;

  async function walk(path: string): Promise<void> {
    await chown(path, uid, gid);
    const info = await stat(path);
    if (!info.isDirectory()) return;
    const entries = await readdir(path);
    for (const entry of entries) {
      await walk(join(path, entry));
    }
  }

  await walk(dir);
}
