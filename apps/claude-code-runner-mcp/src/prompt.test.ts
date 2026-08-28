import { describe, expect, it } from 'vitest';
import { buildCommandPrompt, buildPrompt } from './prompt.js';

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

describe('buildCommandPrompt', () => {
  it('incluye el comando y el prompt del Operador', () => {
    const prompt = buildCommandPrompt({ slashCommand: '/design', prompt: 'landing para Cronos' });
    expect(prompt).toContain('# Comando: /design');
    expect(prompt).toContain('landing para Cronos');
  });

  it('nunca pide publicar un Artifact — pide escribir artifact-output.html (Fase 8, US-8.1)', () => {
    // No es cosmético: claude -p en modo headless no tiene la tool Artifact
    // disponible (verificado empíricamente, ver docs/decisions-log.md — Fase 8).
    // Pedírselo solo le hace perder turnos intentando algo que va a fallar.
    const prompt = buildCommandPrompt({ slashCommand: '/dataviz', prompt: 'dashboard de ventas' });
    expect(prompt).toContain('No tienes disponible la tool `Artifact`');
    expect(prompt).toContain('artifact-output.html');
    expect(prompt).toContain('command-result.json');
  });

  it('incluye el contexto de Brain solo si se proporciona', () => {
    const withContext = buildCommandPrompt({
      slashCommand: '/design',
      prompt: 'p',
      brainContext: 'Usa el morado #7C3AED.',
    });
    expect(withContext).toContain('Contexto recuperado de Brain');
    expect(withContext).toContain('Usa el morado #7C3AED.');

    const withoutContext = buildCommandPrompt({ slashCommand: '/design', prompt: 'p' });
    expect(withoutContext).not.toContain('Contexto recuperado de Brain');
  });
});
