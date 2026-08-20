import { describe, expect, it } from 'vitest';
import { buildPrompt } from './prompt.js';

describe('buildPrompt', () => {
  it('incluye título y descripción de la tarea', () => {
    const prompt = buildPrompt({
      repo: 'owner/repo',
      taskTitle: 'Arregla el bug del login',
      taskDescription: 'El botón de login no responde en Safari.',
    });
    expect(prompt).toContain('# Tarea: Arregla el bug del login');
    expect(prompt).toContain('El botón de login no responde en Safari.');
    expect(prompt).toContain('result.json');
  });

  it('incluye el contexto de Brain solo si se proporciona', () => {
    const withoutContext = buildPrompt({
      repo: 'owner/repo',
      taskTitle: 't',
      taskDescription: 'd',
    });
    expect(withoutContext).not.toContain('Contexto recuperado de Brain');

    const withContext = buildPrompt({
      repo: 'owner/repo',
      taskTitle: 't',
      taskDescription: 'd',
      brainContext: 'Usa siempre TypeScript strict.',
    });
    expect(withContext).toContain('Contexto recuperado de Brain');
    expect(withContext).toContain('Usa siempre TypeScript strict.');
  });

  it('no incluye la sección de contexto si brainContext está vacío/blank', () => {
    const prompt = buildPrompt({
      repo: 'owner/repo',
      taskTitle: 't',
      taskDescription: 'd',
      brainContext: '   ',
    });
    expect(prompt).not.toContain('Contexto recuperado de Brain');
  });
});
