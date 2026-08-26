/**
 * Lectura del estado de los cronjobs de hermes-agent (`/cron`).
 *
 * POR QUÉ SE LEE UN FICHERO Y NO UNA API: hermes-agent no expone el cron por
 * HTTP. Su `dashboard` es una web UI atada a localhost (SEC-0.3) y su CLI solo
 * es alcanzable con acceso al contenedor — que este bot no tiene, y no debe
 * tener, porque exigiría el socket de Docker. Lo único que queda es su fichero
 * de estado.
 *
 * ACOPLAMIENTO DECLARADO: `jobs.json` es un formato INTERNO de hermes-agent,
 * no un contrato público. Puede cambiar en cualquier actualización del
 * upstream. Por eso todo lo que se lee aquí es opcional y se degrada a
 * "desconocido" en vez de romper: un `/cron` que informa de menos es
 * infinitamente mejor que un bot que se cae porque el upstream renombró un
 * campo. Nada de este módulo escribe.
 */

export interface CronJob {
  name: string;
  scheduleDisplay: string;
  /** `scheduled`, `paused`, … tal cual lo escribe hermes. */
  state: string;
  enabled: boolean;
  deliver: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** `ok`, `error`, o null si nunca corrió. */
  lastStatus: string | null;
  lastError: string | null;
  /** El job corrió bien pero su resultado no llegó a destino. */
  lastDeliveryError: string | null;
  skills: string[];
}

export class CronUnavailableError extends Error {}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function parseCronJobs(raw: string): CronJob[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CronUnavailableError('El fichero de cronjobs no es JSON válido.');
  }
  const jobs = (parsed as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) {
    throw new CronUnavailableError(
      'El fichero de cronjobs no tiene la forma esperada (falta `jobs`). ' +
        'Puede que hermes-agent haya cambiado su formato interno.',
    );
  }

  return jobs.map((j): CronJob => {
    const o = j as Record<string, unknown>;
    const skills = Array.isArray(o['skills'])
      ? (o['skills'] as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    return {
      name: str(o['name']) ?? str(o['id']) ?? '(sin nombre)',
      scheduleDisplay: str(o['schedule_display']) ?? '(horario desconocido)',
      state: str(o['state']) ?? 'desconocido',
      // Solo `false` explícito cuenta como deshabilitado: un campo ausente en
      // una versión futura no debe hacer que un job activo aparezca apagado.
      enabled: o['enabled'] !== false,
      deliver: str(o['deliver']),
      nextRunAt: str(o['next_run_at']),
      lastRunAt: str(o['last_run_at']),
      lastStatus: str(o['last_status']),
      lastError: str(o['last_error']),
      lastDeliveryError: str(o['last_delivery_error']),
      skills,
    };
  });
}

/** Antigüedad/espera en lenguaje llano. Sin librería: son tres casos. */
export function relativeTime(iso: string | null, now: Date): string {
  if (iso === null) return 'desconocido';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'desconocido';
  const deltaMin = Math.round((then.getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(deltaMin);
  const amount = abs < 60 ? `${String(abs)} min` : `${(abs / 60).toFixed(1)} h`;
  if (deltaMin >= 0) return `en ${amount}`;
  return `hace ${amount}`;
}

export function formatCronJobs(jobs: CronJob[], now: Date): string {
  if (jobs.length === 0) {
    return 'No hay ningún cronjob configurado en Hermes.';
  }

  const lines = ['Cronjobs de Hermes', ''];
  const avisos: string[] = [];

  for (const job of jobs) {
    const parado = !job.enabled || job.state === 'paused';
    lines.push(`${job.name}${parado ? ' — PAUSADO' : ''}`);
    lines.push(`   cada: ${job.scheduleDisplay}`);
    if (job.skills.length > 0) lines.push(`   skill: ${job.skills.join(', ')}`);
    lines.push(
      parado ? '   próxima: no está programada' : `   próxima: ${relativeTime(job.nextRunAt, now)}`,
    );

    if (job.lastRunAt === null) {
      lines.push('   última: nunca ha corrido');
    } else {
      const veredicto = job.lastStatus === 'ok' ? 'OK' : (job.lastStatus ?? 'desconocido');
      lines.push(`   última: ${relativeTime(job.lastRunAt, now)} — ${veredicto}`);
      if (job.lastError !== null) lines.push(`   error: ${job.lastError}`);
    }

    // Un job puede completar y aun así no entregar nada. Sin esto, el Operador
    // ve "OK" y da por hecho que le llegó un mensaje que nunca salió.
    if (job.lastDeliveryError !== null) {
      lines.push(`   ENTREGA FALLIDA: ${job.lastDeliveryError}`);
      avisos.push(`${job.name}: corrió bien pero su resultado no llegó a destino.`);
    }

    // El fallo de gobierno que motivó este comando: `deliver: local` deja el
    // resultado en el contenedor. El job parece sano y nadie se entera de nada.
    if (job.deliver === null || job.deliver === 'local') {
      lines.push(`   entrega: ${job.deliver ?? 'sin definir'}  <-- no sale del servidor`);
      avisos.push(
        `${job.name}: entrega "${job.deliver ?? 'sin definir'}" — sus resultados y errores ` +
          'no llegan a Telegram. Arréglalo con `hermes cron edit <id> --deliver telegram:<chat_id>`.',
      );
    } else {
      lines.push(`   entrega: ${job.deliver}`);
    }
    lines.push('');
  }

  if (avisos.length > 0) {
    lines.push('Avisos:');
    for (const aviso of avisos) lines.push(`- ${aviso}`);
    lines.push('');
  }

  lines.push('Estado leído del fichero de cron de Hermes (solo lectura). Para');
  lines.push('crear, editar o pausar un job hace falta `hermes cron` en el');
  lines.push('contenedor: este bot no ejecuta nada, solo informa.');
  return lines.join('\n');
}

/** Inyectable para testear sin tocar disco. */
export type ReadFileLike = (path: string) => Promise<string>;

/**
 * Lee y formatea el estado del cron.
 *
 * Los dos fallos previsibles se traducen a instrucciones concretas en vez de a
 * un `ENOENT` crudo: ambos significan "está mal desplegado", y el Operador que
 * lee esto en Telegram no tiene el compose delante.
 */
export async function cronReport(
  path: string | undefined,
  readFile: ReadFileLike,
  now: Date,
): Promise<string> {
  if (path === undefined || path.length === 0) {
    return (
      'No hay ruta de cronjobs configurada (CONTROL_BOT_CRON_JOBS_PATH vacía).\n' +
      'Monta el directorio de cron de Hermes en solo lectura y apunta esa variable\n' +
      'a su jobs.json — ver hermes/config/README.md §12.'
    );
  }

  let raw: string;
  try {
    raw = await readFile(path);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') {
      throw new CronUnavailableError(
        `No encuentro el fichero de cronjobs en ${path}. ¿Está montado el ` +
          'directorio de cron de Hermes en este contenedor?',
      );
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new CronUnavailableError(
        'No tengo permiso para leer el fichero de cronjobs. hermes-agent lo ' +
          'escribe con modo 0600, así que este contenedor debe correr con su ' +
          'mismo uid — ver hermes/config/README.md §12.',
      );
    }
    throw err;
  }

  return formatCronJobs(parseCronJobs(raw), now);
}
