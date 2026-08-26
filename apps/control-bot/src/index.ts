#!/usr/bin/env node
/**
 * Bot de control de PersonalAI (US-9.2).
 *
 * Un segundo bot de Telegram, con su propio token, dedicado a comandos
 * DETERMINISTAS: no hay modelo en ningún punto del camino, así que no consume
 * cuota de Claude Pro y no depende de que un agente decida llamar a la tool
 * correcta. `/metricas` calcula y responde, siempre.
 *
 * Por qué un bot aparte y no un comando del bot de Hermes: los slash commands
 * de hermes-agent están hardcodeados en su registro central y los custom son
 * una petición abierta sin implementar (issues #25335/#31373 del upstream).
 * Además, Telegram solo admite UN consumidor de updates por token, así que
 * este bot no puede compartir el de Hermes — necesita el suyo.
 *
 * Decisión de seguridad deliberada: este proceso lee Postgres directamente y
 * NO tiene el token del runner. Podría haber llamado a `GET /v1/metrics`, pero
 * ese token autentica también `/mcp`, que lanza contenedores Docker — dárselo
 * a un proceso que ingiere texto de Telegram convertiría este bot en una vía
 * de escalada (mismo razonamiento que SEC-2.1 sobre por qué hermes no monta el
 * socket de Docker). Aquí solo hay SELECTs agregados.
 */
import pg from 'pg';
import { runBot } from './bot.js';
import { loadConfig, ConfigError } from './config.js';
import { logger } from './logger.js';
import { TelegramClient } from './telegram.js';

const { Pool } = pg;

async function main(): Promise<void> {
  const config = loadConfig();
  const telegram = new TelegramClient(config.telegramToken);
  const db = new Pool({ connectionString: config.databaseUrl });

  let running = true;
  const stop = (signal: string): void => {
    logger.info({ signal }, 'parando tras el ciclo de polling en curso');
    running = false;
  };
  process.on('SIGTERM', () => {
    stop('SIGTERM');
  });
  process.on('SIGINT', () => {
    stop('SIGINT');
  });

  logger.info({ allowedUsers: config.allowedUsers.size }, 'bot de control escuchando');
  try {
    await runBot(config, telegram, db, () => running);
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    // Configuración inválida: mensaje limpio y código propio, sin volcado de
    // pila — es un error del Operador al desplegar, no un bug.
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  logger.error({ err: error }, 'el bot de control se detuvo por un error');
  process.exitCode = 1;
});
