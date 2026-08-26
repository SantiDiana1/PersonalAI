import { describe, expect, it } from 'vitest';
import {
  formatProbes,
  parseProbes,
  probeAll,
  ProbeConfigError,
  probeProvider,
  type ProviderProbe,
} from './providers.js';
import { handleCommand } from './commands.js';
import type { Queryable } from '@personalai/shared';

const dbNoUsada: Queryable = {
  query: async () => {
    throw new Error('/proveedores no debe tocar la base de datos');
  },
};

/**
 * Ollama y demás endpoints falsos. Es el "mock" del despliegue real: el Mac
 * Mini con el modelo local todavía no existe, así que la integración se
 * verifica contra respuestas con la MISMA forma que documenta la API de
 * Ollama (`/api/tags` -> `{models: [{name}]}`).
 */
function fakeFetch(routes: Record<string, { status: number; body?: unknown } | 'error'>) {
  return (async (url: unknown) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    const route = key === undefined ? 'error' : routes[key]!;
    if (route === 'error') throw new Error('connect ECONNREFUSED');
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: async () => route.body,
    } as Response;
  }) as unknown as typeof fetch;
}

describe('parseProbes', () => {
  it('parsea varios eslabones', () => {
    expect(
      parseProbes('ollama|ollama|http://ollama:11434,anthropic|http|https://api.anthropic.com'),
    ).toEqual([
      { name: 'ollama', kind: 'ollama', url: 'http://ollama:11434' },
      { name: 'anthropic', kind: 'http', url: 'https://api.anthropic.com' },
    ]);
  });

  it('rechaza un tipo desconocido en vez de ignorarlo', () => {
    expect(() => parseProbes('x|telepatia|http://y')).toThrow(ProbeConfigError);
  });

  it('rechaza un eslabón mal formado', () => {
    expect(() => parseProbes('solo-un-nombre')).toThrow(/Formato esperado/);
  });

  it('tolera espacios y entradas vacías', () => {
    expect(parseProbes(' a|http|http://x , ')).toHaveLength(1);
  });
});

describe('probeProvider — ollama', () => {
  const probe: ProviderProbe = { name: 'ollama', kind: 'ollama', url: 'http://ollama:11434' };

  it('lista los modelos descargados', async () => {
    const f = fakeFetch({
      '/api/tags': {
        status: 200,
        body: { models: [{ name: 'qwen2.5:3b' }, { name: 'llama3.2:3b' }] },
      },
    });
    const r = await probeProvider(probe, f);
    expect(r.reachable).toBe(true);
    expect(r.detail).toContain('qwen2.5:3b');
  });

  it('distingue "vivo pero sin modelos" de "caído"', async () => {
    // Es el fallo más traicionero del despliegue: el contenedor arranca, el
    // healthcheck pasa, y la cadena falla igual en el primer turno.
    const f = fakeFetch({ '/api/tags': { status: 200, body: { models: [] } } });
    const r = await probeProvider(probe, f);
    expect(r.reachable).toBe(true);
    expect(r.detail).toContain('SIN modelos descargados');
  });

  it('marca caído cuando no hay nadie escuchando', async () => {
    const r = await probeProvider(probe, fakeFetch({}));
    expect(r.reachable).toBe(false);
    expect(r.detail).toContain('ECONNREFUSED');
  });
});

describe('probeProvider — http', () => {
  const probe: ProviderProbe = {
    name: 'anthropic',
    kind: 'http',
    url: 'https://api.anthropic.com/v1/models',
  };

  it('cuenta un 401 como alcanzable, porque la sonda no lleva credenciales', async () => {
    const r = await probeProvider(probe, fakeFetch({ 'api.anthropic.com': { status: 401 } }));
    expect(r.reachable).toBe(true);
    expect(r.detail).toContain('sin credenciales');
  });
});

describe('formatProbes', () => {
  it('avisa cuando NINGÚN eslabón responde', async () => {
    const probes = parseProbes(
      'ollama|ollama|http://ollama:11434,anthropic|http|https://api.anthropic.com',
    );
    const out = formatProbes(probes, await probeAll(probes, fakeFetch({})));
    expect(out).toContain('0/2 eslabones alcanzables');
    expect(out).toContain('Hermes no podrá contestar');
  });

  it('siempre advierte de que no lee la cadena viva de hermes', async () => {
    // Sin esta advertencia el Operador leería el informe como si fuera la
    // configuración real de hermes, que es justo lo que NO es.
    const probes = parseProbes('ollama|ollama|http://o:1');
    const out = formatProbes(
      probes,
      await probeAll(
        probes,
        fakeFetch({ '/api/tags': { status: 200, body: { models: [{ name: 'm' }] } } }),
      ),
    );
    expect(out).toContain('no lee la cadena viva');
  });

  it('lo dice cuando no hay eslabones configurados', () => {
    expect(formatProbes([], [])).toContain('No hay ningún eslabón configurado');
  });
});

describe('/proveedores como comando', () => {
  it('responde sin tocar la base de datos', async () => {
    const reply = await handleCommand('/proveedores', {
      db: dbNoUsada,
      providerProbes: parseProbes('ollama|ollama|http://ollama:11434'),
      fetchImpl: fakeFetch({
        '/api/tags': { status: 200, body: { models: [{ name: 'qwen2.5:3b' }] } },
      }),
    });
    expect(reply).toContain('qwen2.5:3b');
  });

  it('está en la ayuda', async () => {
    const reply = await handleCommand('/ayuda', { db: dbNoUsada });
    expect(reply).toContain('/proveedores');
  });
});
