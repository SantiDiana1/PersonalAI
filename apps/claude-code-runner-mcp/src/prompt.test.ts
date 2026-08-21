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

describe('contrato de rama y push', () => {
  const input = {
    repo: 'owner/repo',
    taskTitle: 'Titulo',
    taskDescription: 'Descripcion',
  };

  it('prohíbe explícitamente crear ramas, pushear y abrir PRs', () => {
    // No es cosmético: con un GITHUB_TOKEN en el contenedor se observó a Claude
    // Code crear su propia rama, empujarla y abrir un PR, dejando el
    // taskBranchName sin commits. La defensa real es no darle credenciales
    // (ver runContainer.ts), pero el prompt debe declarar el contrato igual.
    const prompt = buildPrompt(input);
    expect(prompt).toContain('No crees ramas nuevas');
    expect(prompt).toContain('No hagas `git push` ni abras Pull Requests');
  });
});
