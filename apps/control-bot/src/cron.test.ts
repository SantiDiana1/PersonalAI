import { describe, expect, it } from 'vitest';
import { handleCommand } from './commands.js';
import {
  CronUnavailableError,
  cronReport,
  formatCronJobs,
  parseCronJobs,
  relativeTime,
} from './cron.js';

const NOW = new Date('2026-08-26T10:00:00.000Z');

/** Copia literal de la forma real de jobs.json del despliegue. */
const REAL_JOB = {
  id: 'd599000fd552',
  name: 'resolve-issues',
  skills: ['resolve-issue'],
  schedule_display: 'every 30m',
  enabled: true,
  state: 'scheduled',
  next_run_at: '2026-08-26T10:23:38.341212+00:00',
  last_run_at: '2026-08-26T09:53:38.341212+00:00',
  last_status: 'ok',
  last_error: null,
  last_delivery_error: null,
  deliver: 'telegram:453464431',
};

/**
 * Construye el fichero variando campos concretos. Se hace sobre el objeto y no
 * con `String.replace` sobre el JSON: `JSON.stringify` no deja espacio tras los
 * dos puntos, así que los reemplazos de texto no casan y el test pasa a
 * ejercitar el fichero sin modificar sin que nadie se entere.
 */
function jobsFile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jobs: [{ ...REAL_JOB, ...overrides }],
    updated_at: '2026-08-26T09:53:49.190975+00:00',
  });
}

const REAL = jobsFile();

const read = (content: string) => () => Promise.resolve(content);

describe('parseCronJobs', () => {
  it('lee la forma real del jobs.json de hermes', () => {
    const [job] = parseCronJobs(REAL);
    expect(job?.name).toBe('resolve-issues');
    expect(job?.lastStatus).toBe('ok');
    expect(job?.deliver).toBe('telegram:453464431');
    expect(job?.skills).toEqual(['resolve-issue']);
  });

  it('no se cae si el upstream renombra campos: degrada a desconocido', () => {
    // jobs.json es formato interno de hermes-agent. Perder un campo debe
    // producir un informe más pobre, nunca un bot caído.
    const [job] = parseCronJobs(JSON.stringify({ jobs: [{ id: 'abc' }] }));
    expect(job?.name).toBe('abc');
    expect(job?.scheduleDisplay).toBe('(horario desconocido)');
    expect(job?.lastStatus).toBeNull();
  });

  it('trata un job sin `enabled` como activo, no como apagado', () => {
    const [job] = parseCronJobs(JSON.stringify({ jobs: [{ name: 'x' }] }));
    expect(job?.enabled).toBe(true);
  });

  it('rechaza un fichero que no tiene la forma esperada', () => {
    expect(() => parseCronJobs('{"otra_cosa": []}')).toThrow(CronUnavailableError);
    expect(() => parseCronJobs('no soy json')).toThrow(CronUnavailableError);
  });
});

describe('formatCronJobs', () => {
  it('avisa de `deliver: local`, que es el fallo que motivó el comando', () => {
    const out = formatCronJobs(parseCronJobs(jobsFile({ deliver: 'local' })), NOW);
    expect(out).toContain('no sale del servidor');
    expect(out).toContain('Avisos:');
    expect(out).toContain('--deliver telegram:');
  });

  it('no avisa cuando la entrega va a Telegram', () => {
    const out = formatCronJobs(parseCronJobs(REAL), NOW);
    expect(out).not.toContain('Avisos:');
    expect(out).toContain('entrega: telegram:453464431');
  });

  it('distingue "corrió bien" de "el resultado llegó"', () => {
    // Un job puede completar y fallar la entrega. Sin esto el Operador ve OK
    // y da por hecho un mensaje que nunca salió.
    const out = formatCronJobs(
      parseCronJobs(jobsFile({ last_delivery_error: 'chat not found' })),
      NOW,
    );
    expect(out).toContain('ENTREGA FALLIDA: chat not found');
    expect(out).toContain('no llegó a destino');
  });

  it('muestra el error de la última ejecución fallida', () => {
    const raw = jobsFile({ last_status: 'error', last_error: 'empty response' });
    expect(formatCronJobs(parseCronJobs(raw), NOW)).toContain('error: empty response');
  });

  it('marca un job pausado y no promete una próxima ejecución', () => {
    const out = formatCronJobs(parseCronJobs(jobsFile({ state: 'paused' })), NOW);
    expect(out).toContain('PAUSADO');
    expect(out).toContain('no está programada');
  });

  it('dice que no hay ninguno en vez de devolver un informe vacío', () => {
    expect(formatCronJobs([], NOW)).toContain('No hay ningún cronjob');
  });
});

describe('relativeTime', () => {
  it('distingue futuro de pasado', () => {
    expect(relativeTime('2026-08-26T10:30:00.000Z', NOW)).toBe('en 30 min');
    expect(relativeTime('2026-08-26T09:30:00.000Z', NOW)).toBe('hace 30 min');
  });

  it('pasa a horas cuando supera los 60 minutos', () => {
    expect(relativeTime('2026-08-26T13:00:00.000Z', NOW)).toBe('en 3.0 h');
  });

  it('no revienta con una fecha ausente o corrupta', () => {
    expect(relativeTime(null, NOW)).toBe('desconocido');
    expect(relativeTime('ayer por la tarde', NOW)).toBe('desconocido');
  });
});

describe('cronReport', () => {
  it('explica qué falta si no hay ruta configurada, en vez de fallar', async () => {
    const out = await cronReport(undefined, read(''), NOW);
    expect(out).toContain('CONTROL_BOT_CRON_JOBS_PATH');
  });

  it('traduce ENOENT a "no está montado"', async () => {
    const fail = () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOENT' }));
    await expect(cronReport('/hermes-cron/jobs.json', fail, NOW)).rejects.toThrow(/montado/);
  });

  it('traduce EACCES al problema real de uid, que es el error probable', async () => {
    // hermes escribe jobs.json con modo 0600 y lo reescribe en cada tick, así
    // que un chmod no aguanta: el contenedor debe correr con su mismo uid.
    const fail = () => Promise.reject(Object.assign(new Error('x'), { code: 'EACCES' }));
    await expect(cronReport('/hermes-cron/jobs.json', fail, NOW)).rejects.toThrow(/uid/);
  });
});

describe('/cron a través de handleCommand', () => {
  const deps = {
    db: { query: () => Promise.resolve({ rows: [] }) },
    cronJobsPath: '/hermes-cron/jobs.json',
    readFileImpl: read(REAL),
    now: () => NOW,
  };

  it('responde al comando y a sus alias', async () => {
    expect(await handleCommand('/cron', deps)).toContain('resolve-issues');
    expect(await handleCommand('/jobs', deps)).toContain('resolve-issues');
  });

  it('un fallo de despliegue llega al chat como instrucción accionable', async () => {
    const out = await handleCommand('/cron', {
      ...deps,
      readFileImpl: () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOENT' })),
    });
    // No el genérico "revisa los logs": el Operador está en Telegram, sin el
    // compose delante, y este error se arregla con una instrucción concreta.
    expect(out).not.toContain('Revisa los logs');
    expect(out).toContain('montado');
  });

  it('aparece en la ayuda', async () => {
    expect(await handleCommand('/ayuda', deps)).toContain('/cron');
  });
});
