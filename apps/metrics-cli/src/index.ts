#!/usr/bin/env node
/**
 * `personalai-metrics` — métricas de uso real del sistema (US-9.2 del
 * roadmap). Solo lectura: no crea esquemas, no migra, no escribe nada.
 *
 * Uso:
 *   personalai-metrics           informe legible
 *   personalai-metrics --json    mismo dato en JSON (para cruzarlo con el
 *                                historial de consumo de la cuenta — Fase 12)
 */
import pg from 'pg';
import { collectMetrics } from '@personalai/shared';
import { formatMetrics } from './format.js';

const { Pool } = pg;

async function main(): Promise<number> {
  const asJson = process.argv.includes('--json');

  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    process.stderr.write(
      'DATABASE_URL no configurada. Este comando lee la misma base de datos que\n' +
        'el runner y Brain — expórtala antes de ejecutarlo.\n',
    );
    return 2;
  }

  const pool = new Pool({ connectionString });
  try {
    const metrics = await collectMetrics(pool);
    process.stdout.write(
      (asJson ? JSON.stringify(metrics, null, 2) : formatMetrics(metrics)) + '\n',
    );
    return 0;
  } finally {
    await pool.end();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`Error leyendo métricas: ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
