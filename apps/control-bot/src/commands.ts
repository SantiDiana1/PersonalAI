/**
 * Registro de comandos del bot de control.
 *
 * La superficie es exactamente esta lista, igual que `ALLOWED_SLASH_COMMANDS`
 * en el runner: no hay interpretación de lenguaje natural, ni un comando
 * genérico "ejecuta X". Un mensaje que no coincida con un comando conocido se
 * contesta con la ayuda, nunca se interpreta.
 */
import { collectMetrics, formatMetrics, type Queryable } from '@personalai/shared';
import { logger } from './logger.js';

export interface CommandDeps {
  db: Queryable;
}

export interface Command {
  /** Nombre canónico, sin la barra. */
  name: string;
  aliases: string[];
  description: string;
  run: (deps: CommandDeps) => Promise<string>;
}

export const COMMANDS: Command[] = [
  {
    name: 'metricas',
    aliases: ['metrics', 'metricas@', 'm'],
    description: 'Métricas de uso: tareas resueltas, tasa de éxito por tool y eventos en Brain.',
    run: async ({ db }) => formatMetrics(await collectMetrics(db)),
  },
];

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

  try {
    return await command.run(deps);
  } catch (err: unknown) {
    // El error real va al log; al chat va algo accionable pero sin filtrar
    // cadenas de conexión ni estructura interna de la base de datos.
    logger.error({ err, command: command.name }, 'comando falló');
    return `No he podido calcular /${command.name}. Revisa los logs del bot de control.`;
  }
}
