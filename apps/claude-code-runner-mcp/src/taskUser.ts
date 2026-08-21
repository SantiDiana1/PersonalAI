/**
 * Usuario con el que corre el contenedor efímero de cada tarea.
 *
 * No puede ser root, y no es una preferencia de estilo: el CLI de Claude Code
 * **se niega** a ejecutar `--dangerously-skip-permissions` con privilegios de
 * root ("cannot be used with root/sudo privileges for security reasons") y sale
 * con código 1. Como el entrypoint de la imagen efímera necesita ese flag para
 * correr de forma no interactiva, un contenedor efímero como root falla siempre.
 *
 * En la Fase 1 esto no se notaba: el runner corría en el host como el usuario
 * del Operador, así que heredar su UID daba un usuario no-root por casualidad.
 * Al meter el runner en su propio contenedor (Fase 2), pasa a correr como root
 * y esa herencia rompe la ejecución. De ahí este módulo.
 */

/** UID/GID del usuario `runner` de la imagen efímera (docker/runner/Dockerfile). */
const IMAGE_RUNNER_UID = 1001;
const IMAGE_RUNNER_GID = 1001;

export interface TaskUser {
  uid: number;
  gid: number;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Resuelve el usuario para el contenedor efímero:
 *
 * 1. `CLAUDE_CODE_RUNNER_TASK_UID`/`GID` si están configurados (escape hatch).
 * 2. El UID del proceso actual, si NO es root — preserva el comportamiento de
 *    la Fase 1 cuando el runner corre directamente en el host.
 * 3. El usuario `runner` de la imagen, cuando el proceso es root (despliegue
 *    contenerizado). Nunca se devuelve 0.
 */
export function resolveTaskUser(): TaskUser {
  const envUid = parsePositiveInt(process.env['CLAUDE_CODE_RUNNER_TASK_UID']);
  const envGid = parsePositiveInt(process.env['CLAUDE_CODE_RUNNER_TASK_GID']);
  if (envUid !== undefined) {
    return { uid: envUid, gid: envGid ?? envUid };
  }

  const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (currentUid !== undefined && currentUid > 0) {
    const currentGid = process.getgid?.() ?? currentUid;
    return { uid: currentUid, gid: currentGid };
  }

  return { uid: IMAGE_RUNNER_UID, gid: IMAGE_RUNNER_GID };
}

/** Formato `uid:gid` que espera la opción `User` de Docker. */
export function taskUserSpec(user: TaskUser = resolveTaskUser()): string {
  return `${user.uid}:${user.gid}`;
}
