import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

// El módulo de base de datos se sustituye entero: estos tests son sobre el
// contrato HTTP de la ruta (autenticación, métodos, formatos, ausencia de
// persistencia), no sobre el SQL — eso ya lo cubren los tests de shared.
const getMetrics = vi.hoisted(() => vi.fn());
vi.mock('./db.js', () => ({ getMetrics }));

const { startHttpServer } = await import('./httpServer.js');

const SECRET = 'x'.repeat(48);

const SAMPLE = {
  generatedAt: '2026-08-26T10:00:00.000Z',
  tasks: {
    byTool: [
      {
        tool: 'run_coding_task' as const,
        total: 3,
        running: 1,
        byStatus: { success: 1, failed: 1, needs_human_input: 0, timed_out: 0 },
        successRate: 0.5,
      },
    ],
    startedLast5h: 2,
    startedLast7d: 4,
    startedLast30d: 9,
  },
  brain: null,
};

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  process.env['CLAUDE_CODE_RUNNER_AUTH_TOKEN'] = SECRET;
  getMetrics.mockReset();
  getMetrics.mockResolvedValue(SAMPLE);
  server = await startHttpServer({ port: 0, host: '127.0.0.1' });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('sin puerto');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const auth = { Authorization: `Bearer ${SECRET}` };

describe('GET /v1/metrics', () => {
  it('exige autenticación Bearer, igual que /mcp (SEC-3.2)', async () => {
    const res = await fetch(`${baseUrl}/v1/metrics`);
    expect(res.status).toBe(401);
    // Sin credencial no debe llegar siquiera a consultar la base de datos.
    expect(getMetrics).not.toHaveBeenCalled();
  });

  it('rechaza un secreto incorrecto', async () => {
    const res = await fetch(`${baseUrl}/v1/metrics`, {
      headers: { Authorization: `Bearer ${'y'.repeat(48)}` },
    });
    expect(res.status).toBe(401);
    expect(getMetrics).not.toHaveBeenCalled();
  });

  it('devuelve el informe en texto plano listo para enviar por Telegram', async () => {
    const res = await fetch(`${baseUrl}/v1/metrics`, { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');

    const body = await res.text();
    expect(body).toContain('run_coding_task');
    expect(body).toContain('50.0 %');
    // El script del webhook depende de que la salida NO empiece por "{": un
    // stdout que sea JSON reemplazaría el payload en vez de exponerse como
    // {script_output}, y no se entregaría nada.
    expect(body.startsWith('{')).toBe(false);
  });

  it('devuelve JSON con ?format=json', async () => {
    const res = await fetch(`${baseUrl}/v1/metrics?format=json`, { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SAMPLE);
  });

  it('responde 503 sin persistencia, en vez de un informe vacío', async () => {
    getMetrics.mockResolvedValue(null);
    const res = await fetch(`${baseUrl}/v1/metrics`, { headers: auth });
    // El script usa `curl --fail`, así que esto se traduce en "no entregar
    // nada" — preferible a mandarle al Operador un informe en blanco que
    // parezca real.
    expect(res.status).toBe(503);
  });

  it('rechaza métodos que no sean GET', async () => {
    const res = await fetch(`${baseUrl}/v1/metrics`, { method: 'POST', headers: auth });
    expect(res.status).toBe(405);
  });
});

describe('rutas del servidor HTTP', () => {
  it('/health sigue siendo público y sin datos sensibles', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('una ruta desconocida sigue devolviendo 404 sin pedir autenticación', async () => {
    const res = await fetch(`${baseUrl}/v1/tareas`, { headers: auth });
    expect(res.status).toBe(404);
  });
});
