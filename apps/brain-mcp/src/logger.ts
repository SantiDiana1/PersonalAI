import pino from 'pino';

export const logger = pino({
  name: 'brain-mcp',
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: ['*.token', 'req.headers.authorization'],
});
