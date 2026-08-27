import { describe, expect, it } from 'vitest';
import { findModelChoice, parseModelChoices, ModelChoicesConfigError } from './modelChoices.js';

describe('parseModelChoices', () => {
  it('parsea varios eslabones separados por coma', () => {
    const choices = parseModelChoices(
      'anthropic|anthropic|claude-sonnet-4-5-20250929,minimax|openrouter|minimax/minimax-m3:free',
    );
    expect(choices).toEqual([
      { alias: 'anthropic', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
      { alias: 'minimax', provider: 'openrouter', model: 'minimax/minimax-m3:free' },
    ]);
  });

  it('acepta el modelo con dos puntos y barra sin romper el parseo', () => {
    const choices = parseModelChoices('nemotron|openrouter|nvidia/nemotron-3.5-lightning:free');
    expect(choices[0]?.model).toBe('nvidia/nemotron-3.5-lightning:free');
  });

  it('ignora entradas vacías (comas colgantes)', () => {
    const choices = parseModelChoices('anthropic|anthropic|claude-sonnet-4-5-20250929,,');
    expect(choices).toHaveLength(1);
  });

  it('rechaza una entrada con un número de campos distinto de tres', () => {
    expect(() => parseModelChoices('anthropic|anthropic')).toThrow(ModelChoicesConfigError);
    expect(() => parseModelChoices('a|b|c|d')).toThrow(ModelChoicesConfigError);
  });

  it('rechaza un campo vacío', () => {
    expect(() => parseModelChoices('|anthropic|modelo')).toThrow(ModelChoicesConfigError);
  });

  it('rechaza un alias duplicado', () => {
    expect(() => parseModelChoices('a|anthropic|modelo-1,a|openrouter|modelo-2')).toThrow(
      ModelChoicesConfigError,
    );
  });

  it('una cadena vacía produce una lista vacía, no un error', () => {
    expect(parseModelChoices('')).toEqual([]);
  });
});

describe('findModelChoice', () => {
  const choices = parseModelChoices(
    'anthropic|anthropic|claude-sonnet-4-5-20250929,Minimax|openrouter|minimax/minimax-m3:free',
  );

  it('encuentra por alias exacto', () => {
    expect(findModelChoice(choices, 'anthropic')?.provider).toBe('anthropic');
  });

  it('no distingue mayúsculas/minúsculas ni espacios sobrantes', () => {
    expect(findModelChoice(choices, '  MINIMAX  ')?.provider).toBe('openrouter');
  });

  it('devuelve undefined si el alias no existe', () => {
    expect(findModelChoice(choices, 'no-existe')).toBeUndefined();
  });
});
