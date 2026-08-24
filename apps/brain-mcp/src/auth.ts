import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Autenticación del endpoint MCP de brain-mcp sobre HTTP. Mismo patrón que
 * apps/claude-code-runner-mcp/src/auth.ts (SEC-3.2 de docs/security.md,
 * aplicado aquí por el mismo motivo aunque brain-mcp no tenga el socket de
 * Docker: defensa en profundidad, secreto propio — SEC-6.4, "un secreto, un
 * propósito" — distinto del de claude-code-runner.
 */

export const MIN_SECRET_LENGTH = 32;

export class MissingBrainMcpSecretError extends Error {
  constructor() {
    super(
      `BRAIN_MCP_AUTH_TOKEN no está configurada o es más corta de ${MIN_SECRET_LENGTH} caracteres. ` +
        'Genera uno con: openssl rand -hex 32',
    );
  }
}

export function requireAuthSecret(): string {
  const secret = process.env['BRAIN_MCP_AUTH_TOKEN']?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new MissingBrainMcpSecretError();
  }
  return secret;
}

export function isAuthorized(authorizationHeader: string | undefined, secret: string): boolean {
  if (!authorizationHeader) return false;

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) return false;

  const presented = createHash('sha256').update(match[1]).digest();
  const expected = createHash('sha256').update(secret).digest();
  return timingSafeEqual(presented, expected);
}
