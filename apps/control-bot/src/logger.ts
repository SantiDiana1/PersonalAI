import pino from 'pino';

/**
 * Nunca loguea el texto de los mensajes entrantes ni el token del bot — mismo
 * criterio que el resto del sistema (docs/security.md SEC-6.2/6.3).
 */
export const logger = pino({
  name: 'control-bot',
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: ['*.token', '*.text'],
});
