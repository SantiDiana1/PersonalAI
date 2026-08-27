/**
 * Registro de comandos del bot de control.
 *
 * La superficie es exactamente esta lista, igual que `ALLOWED_SLASH_COMMANDS`
 * en el runner: no hay interpretación de lenguaje natural, ni un comando
 * genérico "ejecuta X". Un mensaje que no coincida con un comando conocido se
 * contesta con la ayuda, nunca se interpreta.
 */
import { readFile } from 'node:fs/promises';
import type Docker from 'dockerode';
import { collectMetrics, formatMetrics, type Queryable } from '@personalai/shared';
import { logger } from './logger.js';
import { formatProbes, probeAll, type ProviderProbe } from './providers.js';
import { cronReport, CronUnavailableError, type ReadFileLike } from './cron.js';
import {
  readActiveModel,
  setActiveModel,
  restartHermesContainer,
  DockerOperationError,
} from './docker.js';
import { findModelChoice, type ModelChoice } from './modelChoices.js';
import { recordModelChange, lastModelChange } from './modelAudit.js';

export interface CommandDeps {
  db: Queryable;
  /** Vacío si no hay eslabones configurados — `/proveedores` lo dirá. */
  providerProbes?: ProviderProbe[];
  /** Inyectable para poder testear las sondas sin red. */
  fetchImpl?: typeof fetch;
  /** Ruta al jobs.json de Hermes, montado en solo lectura. */
  cronJobsPath?: string;
  /** Inyectable para testear `/cron` sin tocar disco. */
  readFileImpl?: ReadFileLike;
  /** Inyectable para que los tests de `/cron` no dependan del reloj. */
  now?: () => Date;
  /** Cliente Docker acotado (Fase 15, US-15.2) — ver docker.ts. Sin él, `/modelo` no puede cambiar nada. */
  docker?: Docker;
  /** Nombre del contenedor de Hermes contra el que actúa `/modelo`. */
  hermesContainerName?: string;
  /** Eslabones DECLARADOS a los que `/modelo` puede cambiar. Vacío = deshabilitado. */
  modelChoices?: ModelChoice[];
}

export interface Command {
  /** Nombre canónico, sin la barra. */
  name: string;
  aliases: string[];
  description: string;
  run: (deps: CommandDeps, args: string) => Promise<string>;
}

export const COMMANDS: Command[] = [
  {
    name: 'metricas',
    aliases: ['metrics', 'metricas@', 'm'],
    description: 'Métricas de uso: tareas resueltas, tasa de éxito por tool y eventos en Brain.',
    run: async ({ db }) => formatMetrics(await collectMetrics(db)),
  },
  {
    name: 'proveedores',
    aliases: ['providers', 'p'],
    description: 'Estado de los eslabones de la cadena de proveedores del agent loop de Hermes.',
    run: async ({ providerProbes, fetchImpl }) => {
      const probes = providerProbes ?? [];
      return formatProbes(probes, await probeAll(probes, fetchImpl));
    },
  },
  {
    name: 'cron',
    aliases: ['crons', 'jobs', 'c'],
    description: 'Cronjobs de Hermes: horario, próxima ejecución y resultado de la última.',
    run: async ({ cronJobsPath, readFileImpl, now }) => {
      const read: ReadFileLike = readFileImpl ?? ((p: string) => readFile(p, 'utf8'));
      return cronReport(cronJobsPath, read, (now ?? (() => new Date()))());
    },
  },
  {
    name: 'modelo',
    aliases: ['model', 'mod'],
    description:
      'Sin argumento: modelo/proveedor activo. Con un alias (ver /proveedores): lo cambia y reinicia Hermes.',
    run: runModeloCommand,
  },
];

function formatChoicesList(choices: ModelChoice[]): string {
  if (choices.length === 0) return '(sin eslabones configurados)';
  return choices.map((c) => `  ${c.alias} — ${c.provider} / ${c.model}`).join('\n');
}

async function runModeloCommand(deps: CommandDeps, args: string): Promise<string> {
  const { docker, hermesContainerName, modelChoices, db } = deps;
  if (!docker || !hermesContainerName || !modelChoices || modelChoices.length === 0) {
    return (
      'Comando /modelo no disponible: falta configurar el acceso a Docker o ' +
      'CONTROL_BOT_MODEL_CHOICES. Ver docs/security.md SEC-1.6.'
    );
  }

  const alias = args.trim();

  if (alias.length === 0) {
    // Solo lectura: consulta el activo real, sin tocar nada.
    let activeLine: string;
    try {
      const active = await readActiveModel(docker, hermesContainerName);
      activeLine = `Activo ahora: ${active.provider} / ${active.model}`;
    } catch (err: unknown) {
      if (err instanceof DockerOperationError) {
        logger.warn({ err }, 'no se pudo leer el modelo activo');
        return `No he podido leer el modelo activo: ${err.message}`;
      }
      throw err;
    }

    const last = await lastModelChange(db);
    const lastLine = last
      ? `Último cambio: a "${last.alias}" (${last.provider} / ${last.model}), ${last.changedAt.toISOString()}`
      : 'Último cambio: ninguno registrado todavía.';

    return [
      activeLine,
      lastLine,
      '',
      'Eslabones disponibles para /modelo <alias>:',
      formatChoicesList(modelChoices),
    ].join('\n');
  }

  const choice = findModelChoice(modelChoices, alias);
  if (!choice) {
    return [
      `"${alias}" no es un eslabón conocido. Disponibles:`,
      formatChoicesList(modelChoices),
    ].join('\n');
  }

  try {
    await setActiveModel(docker, hermesContainerName, choice.provider, choice.model);
    // Se registra ANTES de reiniciar: si el reinicio se cuelga o tarda, el
    // rastro de qué se pidió ya quedó guardado — no depende de que el
    // contenedor vuelva a responder.
    await recordModelChange(db, choice);
    await restartHermesContainer(docker, hermesContainerName);
  } catch (err: unknown) {
    if (err instanceof DockerOperationError) {
      logger.error({ err, alias }, 'fallo cambiando el modelo activo');
      return `No he podido cambiar el modelo: ${err.message}`;
    }
    throw err;
  }

  return (
    `Cambiado a "${choice.alias}" (${choice.provider} / ${choice.model}) y reiniciando Hermes.\n` +
    'Tardará unos segundos en volver a responder por Telegram.'
  );
}

function helpText(): string {
  const lines = ['Bot de control de PersonalAI. Comandos:', ''];
  for (const command of COMMANDS) {
    lines.push(`/${command.name} — ${command.description}`);
  }
  lines.push('', '/ayuda — esta lista');
  lines.push('', 'Respuestas calculadas directamente de la base de datos: sin modelo, sin gastar');
  lines.push('cuota de Claude Pro.');
  return lines.join('\n');
}

/**
 * Normaliza el texto de un mensaje a un nombre de comando.
 *
 * Telegram añade `@nombre_del_bot` a los comandos en grupos, y la gente escribe
 * con mayúsculas y acentos indistintamente — todo eso se normaliza aquí para
 * que no haga falta acertar la forma exacta.
 */
export function parseCommand(text: string): string | null {
  const first = text.trim().split(/\s+/)[0];
  if (first === undefined || !first.startsWith('/')) return null;
  return first
    .slice(1)
    .split('@')[0]!
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Resuelve un mensaje a la respuesta que hay que enviar.
 *
 * Devuelve siempre un texto: un comando desconocido recibe la ayuda en vez de
 * silencio, porque el silencio de un bot es indistinguible de que esté caído.
 * El filtro de allowlist va ANTES de llegar aquí, en index.ts.
 */
export async function handleCommand(text: string, deps: CommandDeps): Promise<string> {
  const name = parseCommand(text);
  if (name === null || name === 'ayuda' || name === 'help' || name === 'start') {
    return helpText();
  }

  const command = COMMANDS.find((c) => c.name === name || c.aliases.includes(name));
  if (command === undefined) {
    return `Comando desconocido: /${name}\n\n${helpText()}`;
  }

  const args = text.trim().slice(text.trim().indexOf(' ') + 1);
  const commandArgs = text.trim().includes(' ') ? args : '';

  try {
    return await command.run(deps, commandArgs);
  } catch (err: unknown) {
    // Un fallo de despliegue (fichero no montado, permisos) es accionable por
    // el Operador desde el propio chat: su mensaje ya está redactado para eso
    // y no filtra nada interno, así que se muestra tal cual.
    if (err instanceof CronUnavailableError) {
      logger.warn({ err, command: command.name }, 'estado de cron no disponible');
      return err.message;
    }
    // El error real va al log; al chat va algo accionable pero sin filtrar
    // cadenas de conexión ni estructura interna de la base de datos.
    logger.error({ err, command: command.name }, 'comando falló');
    return `No he podido calcular /${command.name}. Revisa los logs del bot de control.`;
  }
}
