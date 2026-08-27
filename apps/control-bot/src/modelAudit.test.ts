import { describe, expect, it } from 'vitest';
import { lastModelChange, migrateModelAudit, recordModelChange } from './modelAudit.js';
import type { Queryable } from '@personalai/shared';

/** Base de datos falsa en memoria: guarda exactamente lo que se insertó. */
function fakeDb(): { db: Queryable; rows: Record<string, unknown>[]; queries: string[] } {
  const rows: Record<string, unknown>[] = [];
  const queries: string[] = [];
  const db: Queryable = {
    async query<T extends object>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
      queries.push(sql);
      if (sql.includes('create schema') || sql.includes('create table')) {
        return { rows: [] as T[] };
      }
      if (sql.trim().startsWith('insert into control_bot.model_changes')) {
        const [alias, provider, model] = params as [string, string, string];
        rows.push({ alias, provider, model, changed_at: new Date() });
        return { rows: [] as T[] };
      }
      if (sql.includes('order by changed_at desc limit 1')) {
        const sorted = [...rows].sort(
          (a, b) => (b['changed_at'] as Date).getTime() - (a['changed_at'] as Date).getTime(),
        );
        return { rows: (sorted.length > 0 ? [sorted[0]] : []) as T[] };
      }
      throw new Error(`consulta no esperada en el fake: ${sql}`);
    },
  };
  return { db, rows, queries };
}

describe('migrateModelAudit', () => {
  it('ejecuta el DDL sin lanzar', async () => {
    const { db, queries } = fakeDb();
    await migrateModelAudit(db);
    expect(
      queries.some((q) => q.includes('create table if not exists control_bot.model_changes')),
    ).toBe(true);
  });
});

describe('recordModelChange + lastModelChange', () => {
  it('devuelve null cuando no hay ningún cambio registrado', async () => {
    const { db } = fakeDb();
    expect(await lastModelChange(db)).toBeNull();
  });

  it('registra un cambio y lo devuelve como el último', async () => {
    const { db } = fakeDb();
    await recordModelChange(db, {
      alias: 'minimax',
      provider: 'openrouter',
      model: 'minimax/minimax-m3:free',
    });
    const last = await lastModelChange(db);
    expect(last).not.toBeNull();
    expect(last?.alias).toBe('minimax');
    expect(last?.provider).toBe('openrouter');
    expect(last?.model).toBe('minimax/minimax-m3:free');
    expect(last?.changedAt).toBeInstanceOf(Date);
  });

  it('con varios cambios, devuelve el más reciente', async () => {
    const { db, rows } = fakeDb();
    await recordModelChange(db, { alias: 'anthropic', provider: 'anthropic', model: 'x' });
    // Fuerza un timestamp posterior determinista, en vez de depender de que
    // el reloj real avance entre dos `await` consecutivos.
    const first = rows[0];
    if (first) first['changed_at'] = new Date(Date.now() - 60_000);
    await recordModelChange(db, { alias: 'minimax', provider: 'openrouter', model: 'y' });

    const last = await lastModelChange(db);
    expect(last?.alias).toBe('minimax');
  });
});
