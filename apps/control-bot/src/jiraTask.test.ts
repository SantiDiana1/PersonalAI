import { describe, expect, it } from 'vitest';
import { buildTareaPrompt, isValidJiraKey, projectOf, TareaConfigError } from './jiraTask.js';

describe('isValidJiraKey', () => {
  it('acepta claves con forma PROYECTO-número', () => {
    expect(isValidJiraKey('WEB-6')).toBe(true);
    expect(isValidJiraKey('MYAI-10')).toBe(true);
    expect(isValidJiraKey('SAM1-123')).toBe(true);
  });

  it('rechaza texto libre, minúsculas o sin número', () => {
    expect(isValidJiraKey('web-6')).toBe(false);
    expect(isValidJiraKey('resuelve la tarea de Jira')).toBe(false);
    expect(isValidJiraKey('WEB-')).toBe(false);
    expect(isValidJiraKey('WEB')).toBe(false);
    expect(isValidJiraKey('')).toBe(false);
  });

  it('ignora espacios sobrantes', () => {
    expect(isValidJiraKey('  WEB-6  ')).toBe(true);
  });
});

describe('projectOf', () => {
  it('extrae el proyecto de una clave válida', () => {
    expect(projectOf('WEB-6')).toBe('WEB');
    expect(projectOf('MYAI-10')).toBe('MYAI');
  });
});

describe('buildTareaPrompt', () => {
  it('incluye la clave y la allowlist de repos, y le dice al sub-turno que se salte el Paso 1', () => {
    const prompt = buildTareaPrompt('WEB-6', { repoAllowlist: ['SantiDiana1/personalWebsite'] });
    expect(prompt).toContain('WEB-6');
    expect(prompt).toContain('SantiDiana1/personalWebsite');
    expect(prompt).toContain('Sáltate el Paso 1');
  });

  it('lanza TareaConfigError si la allowlist de repos está vacía', () => {
    expect(() => buildTareaPrompt('WEB-6', { repoAllowlist: [] })).toThrow(TareaConfigError);
  });
});
