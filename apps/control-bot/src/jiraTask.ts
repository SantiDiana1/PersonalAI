/**
 * Parte determinista de `/tarea <KEY>` (Fase 20, US-20.3) — validar la clave y
 * construir el prompt plantillado del cronjob. Separado de `docker.ts` igual
 * que `modelChoices.ts` lo está de `/modelo`: aquí no hay ningún acceso a
 * Docker, solo texto derivado de config declarada + lo que escribió el
 * Operador.
 *
 * Semántica de disparo único, verificada contra el despliegue real (no
 * asumida): `hermes/skills/status-report/SKILL.md`, sección "Registro del
 * cronjob", documenta que un `schedule` de `hermes cron create` SIN el
 * prefijo `every` (`'30m'`, no `'every 30m'`) dispara una sola vez
 * (`repeat: 1`) y no se repite — `every` es lo que hay que añadir para lo
 * contrario. `createDeterministicTask` en `docker.ts` usa por eso `'1m'`
 * (sin `every`), no un timestamp ISO. Sigue siendo prudente comprobar con
 * `hermes cron list` tras el primer `/tarea` real que el job no queda
 * repitiendo — el hallazgo de arriba es real pero viene de otro skill, no de
 * una prueba dedicada a este comando. Ver docs/roadmap.md Fase 20, US-20.3.
 */

/** Clave de Jira: proyecto en mayúsculas (2-10 caracteres) + guion + número. */
const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}-[0-9]+$/;

export function isValidJiraKey(key: string): boolean {
  return JIRA_KEY_PATTERN.test(key.trim());
}

/** Extrae el proyecto de una clave ya validada (`WEB-6` -> `WEB`). */
export function projectOf(key: string): string {
  const idx = key.lastIndexOf('-');
  return key.slice(0, idx);
}

export interface TareaTaskConfig {
  /** Repos permitidos para el proyecto de la clave dada — nunca adivinados. */
  repoAllowlist: string[];
}

export class TareaConfigError extends Error {}

/**
 * Construye el prompt autocontenido del cronjob de un solo disparo, para
 * `docker.ts::createDeterministicTask`.
 *
 * Deliberadamente NO reimplementa el Paso 1 (búsqueda por JQL) de
 * `resolve-jira-task`: la clave ya viene dada por el Operador (ese es el
 * punto entero de US-20.3 — routing determinista, sin que el modelo elija
 * nada), así que el prompt le dice al sub-turno que se salte la búsqueda y
 * trate esta clave como ya seleccionada, delegando el resto del
 * procedimiento (Paso 2 en adelante: etiquetas, allowlist de repo,
 * transición de estado, delegar en run_coding_task, reportar) íntegro al
 * skill — nunca reimplementado aquí en texto libre. Ver la nota añadida en
 * `hermes/skills/resolve-jira-task/SKILL.md` bajo "Invocación directa por
 * clave".
 */
export function buildTareaPrompt(key: string, config: TareaTaskConfig): string {
  if (config.repoAllowlist.length === 0) {
    throw new TareaConfigError(
      'CONTROL_BOT_TAREA_REPO_ALLOWLIST vacía — /tarea no puede lanzar nada sin una ' +
        'allowlist de repos declarada (misma regla que el cron recurrente de Jira, ' +
        'ver hermes/config/README.md §11).',
    );
  }

  return [
    `Ticket de Jira ya seleccionado, sin búsqueda: ${key}.`,
    '',
    'Estás ejecutando resolve-jira-task. Sáltate el Paso 1 (búsqueda por JQL) — ' +
      `la clave ya viene decidida, no la elijas tú. Léela con jira_get sobre ` +
      `/rest/api/2/issue/${key} y sigue desde el Paso 2 en adelante exactamente como ` +
      'documenta el skill: marca hermes:in-progress, valida la etiqueta ' +
      `repo:<owner>/<nombre> contra la allowlist de abajo, delega en run_coding_task, ` +
      'reporta en el propio ticket.',
    '',
    `Repos permitidos: ${config.repoAllowlist.join(', ')}.`,
    '',
    'Si el ticket no lleva la etiqueta hermes, no lleva repo:<owner>/<nombre>, o ese ' +
      'repo no está en la lista de arriba: sigue la degradación de la Regla 2 del ' +
      'skill tal cual — comenta pidiendo la etiqueta, marca hermes:needs-human, ' +
      'transiciona a Blocked, y termina. No adivines el repo ni proceses el ticket ' +
      'de todas formas.',
  ].join('\n');
}
