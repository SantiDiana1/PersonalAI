import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceDir, workspaceRoot } from './workspace.js';

const VAR = 'CLAUDE_CODE_RUNNER_WORKSPACE_ROOT';

describe('workspaceRoot', () => {
  const original = process.env[VAR];

  afterEach(() => {
    if (original === undefined) delete process.env[VAR];
    else process.env[VAR] = original;
  });

  it('usa os.tmpdir() cuando no hay variable — comportamiento de la Fase 1', () => {
    delete process.env[VAR];
    expect(workspaceRoot()).toBe(tmpdir());
  });

  it('usa la variable cuando está configurada', () => {
    process.env[VAR] = '/var/lib/personalai/workspaces';
    expect(workspaceRoot()).toBe('/var/lib/personalai/workspaces');
  });

  it('ignora una variable vacía o en blanco en vez de crear rutas raras', () => {
    process.env[VAR] = '   ';
    expect(workspaceRoot()).toBe(tmpdir());
  });

  it('crea el directorio de trabajo bajo la raíz configurada, creándola si no existe', async () => {
    const base = await mkdtemp(join(tmpdir(), 'workspace-root-test-'));
    const root = join(base, 'anidado', 'workspaces');
    process.env[VAR] = root;
    try {
      const dir = await createWorkspaceDir();
      expect(dir.startsWith(root)).toBe(true);
      expect((await stat(dir)).isDirectory()).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
