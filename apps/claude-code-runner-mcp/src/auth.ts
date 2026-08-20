import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Autenticación del endpoint MCP sobre HTTP (SEC-3.2 de docs/security.md).
 *
 * Este proceso es el único del sistema con acceso al socket de Docker, así que
 * quien pueda invocar su endpoint puede lanzar tareas de código. La red interna
 * de Compose ya lo aísla (SEC-3.1: sin `ports:` publicados), pero eso es una
 * sola capa; esto es defensa en profundidad para que alcanzar la red no baste.
 */

/** Longitud mínima del secreto. Un secreto corto es equivalente a no tenerlo. */
export const MIN_SECRET_LENGTH = 32;

export class MissingSecretError extends Error {
  constructor() {
    super(
      `CLAUDE_CODE_RUNNER_AUTH_TOKEN no está configurada o es más corta de ${MIN_SECRET_LENGTH} caracteres. ` +
        'El transporte HTTP no arranca sin un secreto fuerte (SEC-3.2 de docs/security.md). ' +
        'Genera uno con: openssl rand -hex 32',
    );
  }
}

/** Lee y valida el secreto del entorno. Lanza si falta o es débil. */
export function requireAuthSecret(): string {
  const secret = process.env['CLAUDE_CODE_RUNNER_AUTH_TOKEN']?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new MissingSecretError();
  }
  return secret;
}

/**
 * Comprueba una cabecera `Authorization` contra el secreto esperado.
 *
 * Comparación en tiempo constante sobre el hash de ambos valores: hashear
 * primero garantiza longitudes iguales (requisito de `timingSafeEqual`) sin
 * filtrar la longitud del secreto por la vía del error.
 */
export function isAuthorized(authorizationHeader: string | undefined, secret: string): boolean {
  if (!authorizationHeader) return false;

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) return false;

  const presented = createHash('sha256').update(match[1]).digest();
  const expected = createHash('sha256').update(secret).digest();
  return timingSafeEqual(presented, expected);
}
