import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type Docker from 'dockerode';
import { runBot } from './bot.js';
import { parseAllowedUsers, type ControlBotConfig } from './config.js';
import { handleCommand, parseCommand } from './commands.js';
import { splitMessage, TelegramClient, type TelegramUpdate } from './telegram.js';
import type { Queryable } from '@personalai/shared';

const OPERADOR = 111;
const DESCONOCIDO = 999;

const CONFIG: ControlBotConfig = {
  telegramToken: 'no-usado',
  allowedUsers: new Set([OPERADOR]),
  databaseUrl: 'no-usado',
  pollTimeoutSeconds: 1,
  providerProbes: [],
  modelChoices: [],
};

/** Base de datos falsa con datos suficientes para un informe real. */
const db = {
  async query<T extends object>(sql: string): Promise<{ rows: T[] }> {
    if (sql.includes('group by tool, status')) {
      return {
        rows: [{ tool: 'run_coding_task', status: 'success', count: '3' }] as unknown as T[],
      };
    }
    if (sql.includes("interval '5 hours'")) {
      return { rows: [{ last_5h: '1', last_7d: '3', last_30d: '3' }] as unknown as T[] };
    }
    if (sql.includes('to_regclass')) return { rows: [{ reg: null }] as unknown as T[] };
    throw new Error(`consulta inesperada: ${sql}`);
  },
} satisfies Queryable;

/** Telegram falso: entrega una tanda de updates y luego para el bucle. */
function fakeTelegram(updates: TelegramUpdate[]) {
  const sent: { chatId: number; text: string }[] = [];
  let delivered = false;
  const client = {
    discardBacklog: async () => undefined,
    getUpdates: async () => {
      if (delivered) return [];
      delivered = true;
      return updates;
    },
    sendMessage: async (chatId: number, text: string) => {
      sent.push({ chatId, text });
    },
  } as unknown as TelegramClient;
  return { client, sent, isDelivered: () => delivered };
}

function mensaje(fromId: number, text: string, updateId = 1): TelegramUpdate {
  return { updateId, message: { chatId: 500, fromId, text } };
}

describe('allowlist (SEC-1.1)', () => {
  it('responde al Operador', async () => {
    const tg = fakeTelegram([mensaje(OPERADOR, '/metricas')]);
    let ticks = 0;
    await runBot(CONFIG, tg.client, db as unknown as pg.Pool, () => ticks++ < 2);

    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]?.text).toContain('run_coding_task');
  });

  it('ignora en SILENCIO a un desconocido, sin contestarle nada', async () => {
    const tg = fakeTelegram([mensaje(DESCONOCIDO, '/metricas')]);
    let ticks = 0;
    await runBot(CONFIG, tg.client, db as unknown as pg.Pool, () => ticks++ < 2);

    // Ni siquiera un "no autorizado": responder confirmaría a un desconocido
    // que el bot existe y está vivo.
    expect(tg.sent).toHaveLength(0);
  });

  it('no filtra métricas aunque el desconocido escriba en el mismo lote', async () => {
    const tg = fakeTelegram([
      mensaje(DESCONOCIDO, '/metricas', 1),
      mensaje(OPERADOR, '/metricas', 2),
    ]);
    let ticks = 0;
    await runBot(CONFIG, tg.client, db as unknown as pg.Pool, () => ticks++ < 2);

    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]?.chatId).toBe(500);
  });
});

describe('robustez del bucle', () => {
  it('un fallo de sendMessage no tumba el bot', async () => {
    const tg = fakeTelegram([mensaje(OPERADOR, '/metricas')]);
    const client = {
      ...tg.client,
      discardBacklog: async () => undefined,
      getUpdates: tg.client.getUpdates.bind(tg.client),
      sendMessage: async () => {
        throw new Error('Telegram caído');
      },
    } as unknown as TelegramClient;

    let ticks = 0;
    // Si el error escapara, esto rechazaría en vez de terminar limpiamente.
    await expect(
      runBot(CONFIG, client, db as unknown as pg.Pool, () => ticks++ < 2),
    ).resolves.toBeUndefined();
  });

  it('descarta el backlog antes de procesar nada', async () => {
    const discardBacklog = vi.fn(async () => 42);
    const getUpdates = vi.fn(async () => []);
    const client = {
      discardBacklog,
      getUpdates,
      sendMessage: vi.fn(),
    } as unknown as TelegramClient;

    let ticks = 0;
    await runBot(CONFIG, client, db as unknown as pg.Pool, () => ticks++ < 1);

    // Un /metricas de ayer no debe contestarse hoy: se arranca desde el offset
    // que devuelve discardBacklog, no desde el principio de la cola.
    expect(discardBacklog).toHaveBeenCalledOnce();
    expect(getUpdates).toHaveBeenCalledWith(42, 1);
  });
});

describe('parseCommand', () => {
  it('normaliza acentos, mayúsculas y el sufijo @bot de los grupos', () => {
    expect(parseCommand('/metricas')).toBe('metricas');
    expect(parseCommand('/Métricas')).toBe('metricas');
    expect(parseCommand('/metricas@personalai_control_bot')).toBe('metricas');
    expect(parseCommand('/METRICAS ahora')).toBe('metricas');
  });

  it('devuelve null para texto que no es un comando', () => {
    expect(parseCommand('hola qué tal')).toBeNull();
  });
});

describe('handleCommand', () => {
  it('contesta con la ayuda ante texto libre, en vez de interpretarlo', async () => {
    // El bot no hace lenguaje natural a propósito: es su garantía de
    // determinismo. Un mensaje suelto recibe la lista de comandos.
    const reply = await handleCommand('dame las métricas por favor', { db });
    expect(reply).toContain('/metricas');
    expect(reply).toContain('sin modelo');
  });

  it('nombra el comando desconocido en vez de ignorarlo', async () => {
    const reply = await handleCommand('/desplegar', { db });
    expect(reply).toContain('Comando desconocido: /desplegar');
  });

  it('acepta los alias documentados', async () => {
    expect(await handleCommand('/metrics', { db })).toContain('run_coding_task');
  });

  it('no filtra detalles internos cuando la consulta falla', async () => {
    const roto: Queryable = {
      query: async () => {
        throw new Error('password authentication failed for user "personalai"');
      },
    };
    const reply = await handleCommand('/metricas', { db: roto });
    expect(reply).not.toContain('password');
    expect(reply).toContain('Revisa los logs');
  });
});

describe('handleCommand — /modelo (Fase 15, US-15.1/US-15.2)', () => {
  const MODEL_CHOICES = [
    { alias: 'anthropic', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
    { alias: 'minimax', provider: 'openrouter', model: 'minimax/minimax-m3:free' },
  ];

  function auditDb(): { db: Queryable; inserted: unknown[][] } {
    const inserted: unknown[][] = [];
    const changes: { alias: string; provider: string; model: string; changed_at: Date }[] = [];
    const database: Queryable = {
      async query<T extends object>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
        if (sql.trim().startsWith('insert into control_bot.model_changes')) {
          inserted.push(params ?? []);
          const [alias, provider, model] = params as [string, string, string];
          changes.push({ alias, provider, model, changed_at: new Date() });
          return { rows: [] as T[] };
        }
        if (sql.includes('order by changed_at desc limit 1')) {
          return { rows: (changes.length > 0 ? [changes[changes.length - 1]] : []) as T[] };
        }
        return { rows: [] as T[] };
      },
    };
    return { db: database, inserted };
  }

  /** Cliente Docker falso: config show devuelve un modelo activo fijo, set/restart solo registran la llamada. */
  function fakeDocker(): {
    docker: Docker;
    execCmds: string[][];
    restarted: string[];
  } {
    const execCmds: string[][] = [];
    const restarted: string[] = [];
    const docker = {
      getContainer(name: string) {
        return {
          async exec(opts: { Cmd: string[] }) {
            execCmds.push(opts.Cmd);
            const isShow = opts.Cmd.includes('show');
            return {
              async start() {
                const { Readable } = await import('node:stream');
                const output = isShow
                  ? "Model:        {'default': 'claude-sonnet-4-5-20250929', 'provider': 'anthropic'}"
                  : '';
                return Readable.from([Buffer.from(output, 'utf8')]);
              },
              async inspect() {
                return { ExitCode: 0 };
              },
            };
          },
          async restart() {
            restarted.push(name);
          },
        };
      },
    } as unknown as Docker;
    return { docker, execCmds, restarted };
  }

  it('sin argumento, informa del modelo activo, el catálogo y no cambia nada', async () => {
    const { docker, restarted } = fakeDocker();
    const { db: auditedDb } = auditDb();
    const reply = await handleCommand('/modelo', {
      db: auditedDb,
      docker,
      hermesContainerName: 'personalai-hermes-1',
      modelChoices: MODEL_CHOICES,
    });
    expect(reply).toContain('Activo ahora: anthropic / claude-sonnet-4-5-20250929');
    expect(reply).toContain('Último cambio: ninguno registrado todavía.');
    expect(reply).toContain('anthropic — anthropic / claude-sonnet-4-5-20250929');
    expect(reply).toContain('minimax — openrouter / minimax/minimax-m3:free');
    expect(restarted).toEqual([]); // consultar nunca reinicia nada
  });

  it('con un alias válido, cambia el modelo, registra el audit y reinicia el contenedor', async () => {
    const { docker, execCmds, restarted } = fakeDocker();
    const { db: auditedDb, inserted } = auditDb();
    const reply = await handleCommand('/modelo minimax', {
      db: auditedDb,
      docker,
      hermesContainerName: 'personalai-hermes-1',
      modelChoices: MODEL_CHOICES,
    });
    expect(reply).toContain('Cambiado a "minimax"');
    expect(reply).toContain('reiniciando Hermes');
    expect(restarted).toEqual(['personalai-hermes-1']);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual(['minimax', 'openrouter', 'minimax/minimax-m3:free']);
    expect(execCmds.some((c) => c.includes('model.provider') && c.includes('openrouter'))).toBe(
      true,
    );
  });

  it('con un alias desconocido, no toca nada y lista los válidos', async () => {
    const { docker, restarted } = fakeDocker();
    const { db: auditedDb, inserted } = auditDb();
    const reply = await handleCommand('/modelo no-existe', {
      db: auditedDb,
      docker,
      hermesContainerName: 'personalai-hermes-1',
      modelChoices: MODEL_CHOICES,
    });
    expect(reply).toContain('"no-existe" no es un eslabón conocido');
    expect(reply).toContain('anthropic — anthropic');
    expect(restarted).toEqual([]);
    expect(inserted).toEqual([]);
  });

  it('sin Docker ni catálogo configurados, lo dice en vez de fallar', async () => {
    const reply = await handleCommand('/modelo', { db });
    expect(reply).toContain('no disponible');
    expect(reply).toContain('SEC-1.6');
  });

  it('acepta el alias /model, en inglés', async () => {
    const { docker } = fakeDocker();
    const { db: auditedDb } = auditDb();
    const reply = await handleCommand('/model', {
      db: auditedDb,
      docker,
      hermesContainerName: 'personalai-hermes-1',
      modelChoices: MODEL_CHOICES,
    });
    expect(reply).toContain('Activo ahora');
  });
});

describe('splitMessage', () => {
  it('no parte lo que cabe', () => {
    expect(splitMessage('corto', 100)).toEqual(['corto']);
  });

  it('parte por líneas para no cortar una cifra a la mitad', () => {
    const chunks = splitMessage('aaaa\nbbbb\ncccc', 10);
    expect(chunks).toEqual(['aaaa\nbbbb', 'cccc']);
    expect(chunks.every((c) => c.length <= 10)).toBe(true);
  });

  it('trocea en duro una línea más larga que el tope', () => {
    const chunks = splitMessage('x'.repeat(25), 10);
    expect(chunks).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  });
});

describe('parseAllowedUsers', () => {
  it('rechaza una allowlist vacía', () => {
    expect(() => parseAllowedUsers('')).toThrow(/allowlist/i);
    expect(() => parseAllowedUsers('  ,  ')).toThrow(/allowlist/i);
  });

  it('rechaza IDs no numéricos en vez de descartarlos en silencio', () => {
    expect(() => parseAllowedUsers('111,pepe')).toThrow(/no numérico/);
  });

  it('acepta una lista con espacios', () => {
    expect(parseAllowedUsers(' 111, 222 ')).toEqual(new Set([111, 222]));
  });
});
