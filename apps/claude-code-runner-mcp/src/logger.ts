import pino from 'pino';

/**
 * Logger estructurado. Nunca loguea el valor de CLAUDE_CODE_OAUTH_TOKEN ni de
 * ningún token de GitHub — ver docs/hermes/spec.md §6 (gestión de secretos).
 */
export const logger = pino({
  name: 'claude-code-runner-mcp',
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: ['*.token', '*.env.CLAUDE_CODE_OAUTH_TOKEN', '*.env.GITHUB_TOKEN'],
});
