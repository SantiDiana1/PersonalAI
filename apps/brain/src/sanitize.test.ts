import { describe, expect, it } from 'vitest';
import { detectSecret } from './sanitize.js';

describe('detectSecret', () => {
  it('deja pasar texto normal en español', () => {
    expect(detectSecret('La convención de branches en este repo es hermes/<slug>.').found).toBe(
      false,
    );
  });

  it('deja pasar una URL o un commit sha largos (no son secretos)', () => {
    expect(
      detectSecret('Ver commit 8c80ceefc1a2b3d4e5f60718293a4b5c6d7e8f90 en el repo.').found,
    ).toBe(false);
    expect(detectSecret('https://github.com/SantiDiana1/PersonalAI/pull/5').found).toBe(false);
  });

  it('detecta un PAT de GitHub fine-grained', () => {
    const result = detectSecret(
      'export GITHUB_TOKEN=github_pat_11A3NUDMQ0HIRdB4aRJkWs_8E9juKOP6nbQKGYak9lE1',
    );
    expect(result.found).toBe(true);
    expect(result.reason).toBe('github-pat-fine-grained');
  });

  it('detecta un token clásico de GitHub', () => {
    expect(detectSecret('token: ghp_1234567890abcdefghijklmnopqrstuv').found).toBe(true);
  });

  it('detecta una API key de Anthropic', () => {
    expect(
      detectSecret('CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-fG1tKL7NXeN6ssHWt1tFHqH4f-6Tsmsm').found,
    ).toBe(true);
  });

  it('detecta un bloque de clave privada PEM', () => {
    expect(detectSecret('-----BEGIN RSA PRIVATE KEY-----\nMIIExxxx').found).toBe(true);
  });

  it('detecta un string genérico de alta entropía aunque no encaje en ningún patrón conocido', () => {
    const result = detectSecret('secret=Zk9m2QpX7vLwT4nR8bYcE1sD6hJ0aFgN3uMoK5iP');
    expect(result.found).toBe(true);
    expect(result.reason).toBe('high-entropy-string');
  });

  it('no marca texto con puntuación/repetición típica de prosa aunque sea largo', () => {
    const prose =
      'Esta es una frase bastante larga que un Operador podría pegar como nota, ' +
      'sin ningún secreto dentro, solo para probar que el detector de entropía no dispara falsos positivos.';
    expect(detectSecret(prose).found).toBe(false);
  });
});
