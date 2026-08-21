import { afterEach, describe, expect, it } from 'vitest';
import { isAuthorized, MIN_SECRET_LENGTH, MissingSecretError, requireAuthSecret } from './auth.js';

const SECRET = 'a'.repeat(MIN_SECRET_LENGTH);

describe('isAuthorized', () => {
  it('acepta la cabecera Bearer correcta', () => {
    expect(isAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it('es insensible a mayúsculas en el esquema y tolera espacios alrededor', () => {
    expect(isAuthorized(`  bearer   ${SECRET}  `, SECRET)).toBe(true);
  });

  it('rechaza cuando falta la cabecera', () => {
    expect(isAuthorized(undefined, SECRET)).toBe(false);
    expect(isAuthorized('', SECRET)).toBe(false);
  });

  it('rechaza un secreto incorrecto, aunque comparta prefijo', () => {
    expect(isAuthorized(`Bearer ${'a'.repeat(MIN_SECRET_LENGTH - 1)}b`, SECRET)).toBe(false);
    expect(isAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorized(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
  });

  it('rechaza esquemas que no son Bearer', () => {
    expect(isAuthorized(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorized(SECRET, SECRET)).toBe(false);
  });
});

describe('requireAuthSecret', () => {
  const original = process.env['CLAUDE_CODE_RUNNER_AUTH_TOKEN'];

  afterEach(() => {
    if (original === undefined) delete process.env['CLAUDE_CODE_RUNNER_AUTH_TOKEN'];
    else process.env['CLAUDE_CODE_RUNNER_AUTH_TOKEN'] = original;
  });

  it('lanza si no está configurada', () => {
    delete process.env['CLAUDE_CODE_RUNNER_AUTH_TOKEN'];
    expect(() => requireAuthSecret()).toThrow(MissingSecretError);
  });

  it('lanza si el secreto es demasiado corto — un secreto débil no es mejor que ninguno', () => {
    process.env['CLAUDE_CODE_RUNNER_AUTH_TOKEN'] = 'corto';
    expect(() => requireAuthSecret()).toThrow(MissingSecretError);
  });

  it('devuelve el secreto cuando es suficientemente largo', () => {
    process.env['CLAUDE_CODE_RUNNER_AUTH_TOKEN'] = SECRET;
    expect(requireAuthSecret()).toBe(SECRET);
  });
});
