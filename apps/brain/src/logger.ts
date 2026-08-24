import pino from 'pino';

/**
 * Logger estructurado. Nunca loguea el texto ingestado en crudo (puede
 * contener notas personales) ni ningún secreto — ver
 * docs/personal-brain/spec.md §7 (privacidad) y docs/security.md SEC-6.2/6.3.
 */
export const logger = pino({
  name: 'brain',
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: ['*.text', '*.token', 'req.headers.authorization'],
});
