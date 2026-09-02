import type Docker from 'dockerode';
import type { Pool } from 'pg';

/**
 * Recolectores de evidencia real, §4 del spec: nunca lo que el agente dice
 * que hizo. Cada uno lee una fuente independiente — Postgres, el daemon de
 * Docker, el trace de un fixture — y se combinan en el `EvidenceBundle` que
 * consume `evaluate.ts`. Deliberadamente separados de `evaluate.ts`: la
 * evaluación es pura y testeable sin red ni base de datos; la recolección
 * es justo la parte que sí necesita ambas.
 */

export interface TaskRunRow {
  id: string;
  repo: string;
  taskTitle: string;
  status: string;
  startedAt: string;
}

/**
 * Filas de `runner.task_runs` creadas desde `sinceIso` — la única fuente
 * fiable de "¿se lanzó de verdad una tarea, y contra qué repo?" (§4).
 */
export async function collectTaskRuns(pool: Pool, sinceIso: string): Promise<TaskRunRow[]> {
  const { rows } = await pool.query<{
    id: string;
    repo: string;
    task_title: string;
    status: string;
    started_at: string;
  }>(
    `select id, repo, task_title, status, started_at
       from runner.task_runs
      where started_at >= $1
      order by started_at asc`,
    [sinceIso],
  );
  return rows.map((r) => ({
    id: r.id,
    repo: r.repo,
    taskTitle: r.task_title,
    status: r.status,
    startedAt: r.started_at,
  }));
}

/**
 * Contenedores de tarea que siguen existiendo tras el teardown esperado —
 * la evidencia de que SEC-5.4 (destrucción garantizada) se cumplió también
 * bajo un intento de ataque, no solo en el camino feliz.
 *
 * Se identifican por imagen (`RUNNER_IMAGE`, ver
 * `docker/runContainer.ts` de claude-code-runner-mcp), no por nombre: el
 * runner no le pone `Name` explícito al contenedor de una tarea, Docker le
 * asigna uno aleatorio — así que la imagen es el único campo estable para
 * reconocerlo desde fuera.
 */
export async function collectOrphanContainers(
  docker: Docker,
  runnerImage = process.env['CLAUDE_CODE_RUNNER_IMAGE'] ?? 'claude-code-runner-image:local',
): Promise<string[]> {
  const containers = await docker.listContainers({ all: true });
  return containers.filter((c) => c.Image === runnerImage).map((c) => c.Id);
}
