import { describe, expect, it } from 'vitest';
import {
  collectBrainMetrics,
  collectMetrics,
  collectTaskMetrics,
  type Queryable,
} from './metrics.js';

/**
 * Postgres falso que responde según un fragmento reconocible de cada
 * consulta. Es deliberadamente tonto: lo que se está probando es la
 * agregación en TypeScript (tasas, ventanas, tools ausentes), no el SQL.
 */
function fakeDb(responses: { match: string; rows: object[] }[]): Queryable {
  return {
    async query<T extends object>(sql: string): Promise<{ rows: T[] }> {
      const hit = responses.find((r) => sql.includes(r.match));
      if (!hit) throw new Error(`consulta inesperada en el test: ${sql}`);
      return { rows: hit.rows as T[] };
    },
  };
}

const WINDOWS_ZERO = {
  match: "interval '5 hours'",
  rows: [{ last_5h: '0', last_7d: '0', last_30d: '0' }],
};

describe('collectTaskMetrics', () => {
  it('separa las métricas por tool en vez de mezclarlas', async () => {
    const db = fakeDb([
      {
        match: 'group by tool, status',
        rows: [
          { tool: 'run_coding_task', status: 'success', count: '8' },
          { tool: 'run_coding_task', status: 'failed', count: '2' },
          { tool: 'run_claude_command', status: 'failed', count: '5' },
        ],
      },
      WINDOWS_ZERO,
    ]);

    const metrics = await collectTaskMetrics(db);
    const coding = metrics.byTool.find((t) => t.tool === 'run_coding_task');
    const command = metrics.byTool.find((t) => t.tool === 'run_claude_command');

    // El punto entero de la columna `tool`: sin ella esto daría 8/15 = 53 %
    // para "run_coding_task", contaminado por los fallos de /design.
    expect(coding?.successRate).toBe(0.8);
    expect(command?.successRate).toBe(0);
  });

  it('devuelve las dos tools aunque una no tenga ninguna fila', async () => {
    const db = fakeDb([
      {
        match: 'group by tool, status',
        rows: [{ tool: 'run_coding_task', status: 'success', count: '1' }],
      },
      WINDOWS_ZERO,
    ]);

    const metrics = await collectTaskMetrics(db);
    expect(metrics.byTool.map((t) => t.tool)).toEqual(['run_coding_task', 'run_claude_command']);
    expect(metrics.byTool[1]?.total).toBe(0);
  });

  it('distingue "sin tareas terminadas" de "ninguna con éxito"', async () => {
    const db = fakeDb([
      {
        match: 'group by tool, status',
        rows: [
          { tool: 'run_coding_task', status: 'running', count: '3' },
          { tool: 'run_claude_command', status: 'failed', count: '1' },
        ],
      },
      WINDOWS_ZERO,
    ]);

    const metrics = await collectTaskMetrics(db);
    // 3 en curso, ninguna terminada -> null, no 0: un 0 % aquí sería mentira.
    expect(metrics.byTool[0]?.successRate).toBeNull();
    expect(metrics.byTool[0]?.total).toBe(3);
    expect(metrics.byTool[1]?.successRate).toBe(0);
  });

  it('no cuenta las tareas en curso como fracasos en la tasa de éxito', async () => {
    const db = fakeDb([
      {
        match: 'group by tool, status',
        rows: [
          { tool: 'run_coding_task', status: 'success', count: '2' },
          { tool: 'run_coding_task', status: 'running', count: '98' },
        ],
      },
      WINDOWS_ZERO,
    ]);

    const metrics = await collectTaskMetrics(db);
    expect(metrics.byTool[0]?.successRate).toBe(1);
    expect(metrics.byTool[0]?.total).toBe(100);
  });

  it('lee las tres ventanas temporales', async () => {
    const db = fakeDb([
      { match: 'group by tool, status', rows: [] },
      { match: "interval '5 hours'", rows: [{ last_5h: '4', last_7d: '11', last_30d: '37' }] },
    ]);

    const metrics = await collectTaskMetrics(db);
    expect(metrics.startedLast5h).toBe(4);
    expect(metrics.startedLast7d).toBe(11);
    expect(metrics.startedLast30d).toBe(37);
  });
});

describe('collectBrainMetrics', () => {
  it('devuelve null si el esquema de Brain no existe todavía', async () => {
    const db = fakeDb([{ match: 'to_regclass', rows: [{ reg: null }] }]);
    expect(await collectBrainMetrics(db)).toBeNull();
  });

  it('agrega eventos totales, de los últimos 7 días, y por fuente', async () => {
    const db = fakeDb([
      { match: 'to_regclass', rows: [{ reg: 'brain.raw_events' }] },
      { match: "interval '7 days'", rows: [{ total: '120', last_7d: '9' }] },
      {
        match: 'group by source',
        rows: [
          { source: 'github', count: '100' },
          { source: 'telegram', count: '20' },
        ],
      },
    ]);

    const brain = await collectBrainMetrics(db);
    expect(brain?.totalEvents).toBe(120);
    expect(brain?.eventsLast7d).toBe(9);
    expect(brain?.bySource).toEqual([
      { source: 'github', count: 100 },
      { source: 'telegram', count: 20 },
    ]);
  });
});

describe('collectMetrics', () => {
  it('compone tareas y Brain con una marca de tiempo inyectable', async () => {
    const db = fakeDb([
      { match: 'group by tool, status', rows: [] },
      { match: "interval '5 hours'", rows: [{ last_5h: '2', last_7d: '2', last_30d: '2' }] },
      { match: 'to_regclass', rows: [{ reg: null }] },
    ]);

    const metrics = await collectMetrics(db, () => new Date('2026-08-26T10:00:00Z'));
    expect(metrics.generatedAt).toBe('2026-08-26T10:00:00.000Z');
    expect(metrics.brain).toBeNull();
    expect(metrics.tasks.startedLast5h).toBe(2);
  });
});
