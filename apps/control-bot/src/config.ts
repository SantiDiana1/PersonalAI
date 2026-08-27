/**
 * Configuración del bot de control. Todo obligatorio y validado al arrancar:
 * un bot de Telegram mal configurado que arranca "a medias" es peor que uno
 * que no arranca — puede quedarse escuchando sin allowlist.
 */

import { parseProbes, type ProviderProbe } from './providers.js';
import { parseModelChoices, type ModelChoice } from './modelChoices.js';

export interface ControlBotConfig {
  telegramToken: string;
  /** IDs numéricos de Telegram autorizados. Nunca vacío. */
  allowedUsers: Set<number>;
  databaseUrl: string;
  /** Segundos de long polling contra getUpdates. */
  pollTimeoutSeconds: number;
  /**
   * Eslabones de la cadena de proveedores a sondear con `/proveedores`.
   * Opcional y puede quedar vacía: el bot sigue sirviendo `/metricas`, que no
   * depende de ningún proveedor.
   */
  providerProbes: ProviderProbe[];
  /**
   * Ruta al `jobs.json` de hermes-agent, montado en solo lectura. Opcional:
   * sin ella el bot arranca igual y `/cron` explica qué falta, en vez de
   * impedir que `/metricas` funcione por una función que no se usa.
   */
  cronJobsPath?: string;
  /**
   * Eslabones a los que `/modelo` puede cambiar (Fase 15, US-15.2). Opcional:
   * sin ella, `/modelo` explica que no está configurado en vez de arrancar el
   * bot a medias.
   */
  modelChoices: ModelChoice[];
  /** Nombre del contenedor de Hermes contra el que actúa `/modelo`. */
  hermesContainerName?: string;
}

export class ConfigError extends Error {}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ConfigError(`${name} no está configurada — el bot de control no arranca sin ella.`);
  }
  return value;
}

/**
 * Parsea la allowlist de usuarios (SEC-1.1 aplicado a este bot).
 *
 * Se exige explícita y no vacía a propósito: este bot tiene su propio token,
 * así que su chat es público en el sentido de que cualquiera que descubra el
 * nombre del bot puede escribirle. Sin allowlist, un desconocido podría pedir
 * las métricas del sistema del Operador.
 */
export function parseAllowedUsers(raw: string): Set<number> {
  const ids = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const id = Number.parseInt(part, 10);
      if (!Number.isSafeInteger(id)) {
        throw new ConfigError(`CONTROL_BOT_ALLOWED_USERS contiene un ID no numérico: "${part}"`);
      }
      return id;
    });

  if (ids.length === 0) {
    throw new ConfigError(
      'CONTROL_BOT_ALLOWED_USERS está vacía. Sin allowlist el bot respondería a cualquiera ' +
        'que descubra su nombre en Telegram — se exige explícita (SEC-1.1).',
    );
  }
  return new Set(ids);
}

export function loadConfig(): ControlBotConfig {
  const rawTimeout = process.env['CONTROL_BOT_POLL_TIMEOUT_SECONDS'];
  const pollTimeoutSeconds = rawTimeout ? Number.parseInt(rawTimeout, 10) : 30;
  if (!Number.isInteger(pollTimeoutSeconds) || pollTimeoutSeconds < 1 || pollTimeoutSeconds > 50) {
    // 50 es el tope que documenta la Bot API para getUpdates.
    throw new ConfigError(
      `CONTROL_BOT_POLL_TIMEOUT_SECONDS inválido: ${String(rawTimeout)} (esperado 1-50)`,
    );
  }

  const rawProbes = process.env['CONTROL_BOT_PROVIDER_PROBES']?.trim() ?? '';
  const cronJobsPath = process.env['CONTROL_BOT_CRON_JOBS_PATH']?.trim();
  const rawModelChoices = process.env['CONTROL_BOT_MODEL_CHOICES']?.trim() ?? '';
  const hermesContainerName = process.env['CONTROL_BOT_HERMES_CONTAINER_NAME']?.trim();

  return {
    providerProbes: rawProbes.length > 0 ? parseProbes(rawProbes) : [],
    ...(cronJobsPath !== undefined && cronJobsPath.length > 0 ? { cronJobsPath } : {}),
    modelChoices: rawModelChoices.length > 0 ? parseModelChoices(rawModelChoices) : [],
    ...(hermesContainerName !== undefined && hermesContainerName.length > 0
      ? { hermesContainerName }
      : {}),
    telegramToken: required('CONTROL_BOT_TELEGRAM_TOKEN'),
    allowedUsers: parseAllowedUsers(required('CONTROL_BOT_ALLOWED_USERS')),
    databaseUrl: required('DATABASE_URL'),
    pollTimeoutSeconds,
  };
}
