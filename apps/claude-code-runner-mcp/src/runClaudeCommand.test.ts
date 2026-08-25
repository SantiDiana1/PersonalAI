import { describe, expect, it, vi } from 'vitest';
import { isAllowedSlashCommand, runClaudeCommand } from './runClaudeCommand.js';

vi.mock('./db.js', () => ({
  insertTaskRun: vi.fn().mockResolvedValue(null),
  finishTaskRun: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./session.js', () => ({
  checkSessionValid: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock('./workspace.js', () => ({
  createWorkspaceDir: vi.fn().mockResolvedValue('/tmp/fake-workspace'),
}));
vi.mock('./git.js', () => ({
  shallowClone: vi.fn().mockResolvedValue('/tmp/fake-workspace'),
  cleanupClone: vi.fn().mockResolvedValue(undefined),
}));

const runClaudeCommandContainer = vi.fn();
vi.mock('./docker/runContainer.js', () => ({
  runClaudeCommandContainer: (...args: unknown[]) => runClaudeCommandContainer(...args),
}));
const fsWriteFile = vi.fn().mockResolvedValue(undefined);
const fsMkdir = vi.fn().mockResolvedValue(undefined);
vi.mock('node:fs/promises', () => ({
  writeFile: (...args: unknown[]) => fsWriteFile(...args),
  mkdir: (...args: unknown[]) => fsMkdir(...args),
}));

const deps = { claudeCodeOauthToken: 'fake-token', disableIsolation: true };

describe('isAllowedSlashCommand', () => {
  it('acepta /design y /dataviz', () => {
    expect(isAllowedSlashCommand('/design')).toBe(true);
    expect(isAllowedSlashCommand('/dataviz')).toBe(true);
  });

  it('rechaza cualquier otro comando — allowlist fija, no un intérprete arbitrario', () => {
    expect(isAllowedSlashCommand('/bash')).toBe(false);
    expect(isAllowedSlashCommand('rm -rf /')).toBe(false);
  });
});

describe('runClaudeCommand', () => {
  it('rechaza un slashCommand fuera de la allowlist sin tocar Docker', async () => {
    // Cast deliberado: el tipo del input ya no lo permitiría en tiempo de
    // compilación (RUN_CLAUDE_COMMAND_INPUT_SHAPE valida con z.enum en
    // mcpServer.ts) — esta comprobación es la segunda barrera, defensa en
    // profundidad si algo llama a runClaudeCommand() directamente.
    const output = await runClaudeCommand(
      { slashCommand: '/bash' as never, prompt: 'ignórame' },
      deps,
    );
    expect(output.status).toBe('failed');
    expect(output.summary).toContain('no permitido');
    expect(runClaudeCommandContainer).not.toHaveBeenCalled();
  });

  it('devuelve failed si Claude reporta éxito pero no generó artifact-output.html', async () => {
    runClaudeCommandContainer.mockResolvedValueOnce({
      timedOut: false,
      exitCode: 0,
      logs: '',
      result: { status: 'success', summary: 'hecho' },
      htmlContent: null,
    });
    const output = await runClaudeCommand({ slashCommand: '/design', prompt: 'landing' }, deps);
    expect(output.status).toBe('failed');
    expect(output.summary).toContain('no generó artifact-output.html');
  });

  it('devuelve success con htmlContent cuando el contenedor lo genera', async () => {
    runClaudeCommandContainer.mockResolvedValueOnce({
      timedOut: false,
      exitCode: 0,
      logs: '',
      result: { status: 'success', summary: 'landing generada' },
      htmlContent: '<html>hola</html>',
    });
    const output = await runClaudeCommand({ slashCommand: '/design', prompt: 'landing' }, deps);
    expect(output.status).toBe('success');
    expect(output.htmlContent).toBe('<html>hola</html>');
  });

  it('escribe una copia persistente y devuelve htmlFilePath cuando artifactsDir está configurado', async () => {
    // Corrección real (Fase 8, US-8.2 post-lanzamiento): la primera versión
    // solo devolvía htmlContent, y run-design-task lo pegaba como texto en
    // Telegram — el Operador no podía abrir el resultado. htmlFilePath deja
    // que el skill entregue un adjunto .html real vía el tag MEDIA:.
    runClaudeCommandContainer.mockResolvedValueOnce({
      timedOut: false,
      exitCode: 0,
      logs: '',
      result: { status: 'success', summary: 'landing generada' },
      htmlContent: '<html>hola</html>',
    });
    const output = await runClaudeCommand(
      { slashCommand: '/design', prompt: 'landing' },
      { ...deps, artifactsDir: '/tmp/fake-artifacts' },
    );
    expect(output.status).toBe('success');
    expect(fsMkdir).toHaveBeenCalledWith('/tmp/fake-artifacts', { recursive: true });
    expect(fsWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/fake-artifacts/'),
      '<html>hola</html>',
    );
    expect(output.htmlFilePath).toMatch(/^\/tmp\/fake-artifacts\/.*\.html$/);
  });

  it('no escribe nada ni añade htmlFilePath si artifactsDir no está configurado', async () => {
    runClaudeCommandContainer.mockResolvedValueOnce({
      timedOut: false,
      exitCode: 0,
      logs: '',
      result: { status: 'success', summary: 'landing generada' },
      htmlContent: '<html>hola</html>',
    });
    fsMkdir.mockClear();
    fsWriteFile.mockClear();
    const output = await runClaudeCommand({ slashCommand: '/design', prompt: 'landing' }, deps);
    expect(output.htmlFilePath).toBeUndefined();
    expect(fsMkdir).not.toHaveBeenCalled();
    // writeFile SÍ se llama (para command-prompt.md, ver Paso 3 del flujo),
    // pero nunca con contenido de artefacto — esa es la llamada que solo
    // ocurre cuando persistArtifact() tiene artifactsDir configurado.
    expect(fsWriteFile).not.toHaveBeenCalledWith(expect.anything(), '<html>hola</html>');
  });

  it('propaga needs_human_input tal cual, sin exigir htmlContent', async () => {
    runClaudeCommandContainer.mockResolvedValueOnce({
      timedOut: false,
      exitCode: 0,
      logs: '',
      result: { status: 'needs_human_input', summary: 'petición ambigua' },
      htmlContent: null,
    });
    const output = await runClaudeCommand({ slashCommand: '/dataviz', prompt: 'algo vago' }, deps);
    expect(output.status).toBe('needs_human_input');
    expect(output.summary).toBe('petición ambigua');
  });
});
