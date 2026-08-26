/**
 * Bucle de polling del bot de control. Separado de `index.ts` para que los
 * tests lo ejerciten sin arrancar el proceso ni tocar la red.
 */
import type pg from 'pg';
import type { ControlBotConfig } from './config.js';
import { handleCommand } from './commands.js';
import { logger } from './logger.js';
import type { TelegramClient } from './telegram.js';

export async function runBot(
  config: ControlBotConfig,
  telegram: TelegramClient,
  db: pg.Pool,
  shouldContinue: () => boolean,
): Promise<void> {
  let offset = await telegram.discardBacklog();

  while (shouldContinue()) {
    let updates;
    try {
      updates = await telegram.getUpdates(offset, config.pollTimeoutSeconds);
    } catch (err: unknown) {
      // Un fallo de red contra Telegram es esperable y transitorio. Se espera
      // antes de reintentar para no montar un bucle cerrado de peticiones
      // fallidas si la API está caída.
      logger.warn({ err }, 'getUpdates falló, reintentando');
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      continue;
    }

    for (const update of updates) {
      offset = update.updateId + 1;
      const message = update.message;
      if (message === undefined) continue;

      if (!config.allowedUsers.has(message.fromId)) {
        // Silencio deliberado: contestar "no autorizado" le confirmaría a un
        // desconocido que el bot existe y está vivo. Queda en el log, que es
        // donde el Operador sí quiere verlo.
        logger.warn({ fromId: message.fromId }, 'mensaje de usuario no autorizado, ignorado');
        continue;
      }

      const reply = await handleCommand(message.text, {
        db,
        providerProbes: config.providerProbes,
        ...(config.cronJobsPath !== undefined ? { cronJobsPath: config.cronJobsPath } : {}),
      });
      try {
        await telegram.sendMessage(message.chatId, reply);
      } catch (err: unknown) {
        logger.error({ err }, 'no se pudo entregar la respuesta');
      }
    }
  }
}

/** Espera entre reintentos tras un fallo de red contra Telegram. */
export const RETRY_DELAY_MS = 5_000;
