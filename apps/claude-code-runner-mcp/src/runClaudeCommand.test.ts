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
vi.mock('node:fs/promises', () => ({ writeFile: vi.fn().mockResolvedValue(undefined) }));

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
