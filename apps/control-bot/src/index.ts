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
 * Decisión de seguridad deliberada, con UNA excepción declarada desde la Fase
 * 15 (US-15.2, ver docs/security.md SEC-1.6): este proceso lee Postgres
 * directamente y NO tiene el token del runner — dárselo, junto con el resto
 * de tools de `/mcp`, sí sería una vía de escalada abierta. Lo que SÍ tiene
 * ahora es acceso al socket de Docker, pero acotado en código (`docker.ts`) a
 * tres operaciones fijas contra un único contenedor por nombre, nunca un
 * comando arbitrario — es la misma clase de excepción, ya aceptada para
 * `claude-code-runner-mcp` en SEC-2.1, aplicada aquí por segunda vez.
 */
import pg from 'pg';
import Docker from 'dockerode';
import { runBot } from './bot.js';
import { loadConfig, ConfigError } from './config.js';
import { logger } from './logger.js';
import { migrateModelAudit } from './modelAudit.js';
import { TelegramClient } from './telegram.js';

const { Pool } = pg;

async function main(): Promise<void> {
  const config = loadConfig();
  const telegram = new TelegramClient(config.telegramToken);
  const db = new Pool({ connectionString: config.databaseUrl });
  await migrateModelAudit(db);

  // Solo si hay algo que /modelo pueda hacer con él: sin CONTROL_BOT_MODEL_CHOICES
  // ni CONTROL_BOT_HERMES_CONTAINER_NAME, el cliente Docker no se instancia —
  // un bot que no necesita el socket no debería intentar conectarse a él.
  const docker =
    config.modelChoices.length > 0 && config.hermesContainerName !== undefined
      ? new Docker()
      : undefined;

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
    await runBot(config, telegram, db, () => running, docker);
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
