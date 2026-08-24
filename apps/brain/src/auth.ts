import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Autenticación de la API HTTP de Brain (docs/personal-brain/spec.md §5.1):
 * "token estático simple (Bearer) — solo la llama brain-mcp (mismo host/red
 * interna del servidor local), no hace falta OAuth para v1".
 *
 * Mismo patrón que apps/claude-code-runner-mcp/src/auth.ts (comparación en
 * tiempo constante sobre el hash, para no filtrar nada por temporización).
 */

export const MIN_SECRET_LENGTH = 32;

export class MissingBrainSecretError extends Error {
  constructor() {
    super(
      `BRAIN_API_TOKEN no está configurada o es más corta de ${MIN_SECRET_LENGTH} caracteres. ` +
        'La API de Brain no arranca sin un secreto fuerte. Genera uno con: openssl rand -hex 32',
    );
  }
}

export function requireAuthSecret(): string {
  const secret = process.env['BRAIN_API_TOKEN']?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new MissingBrainSecretError();
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
