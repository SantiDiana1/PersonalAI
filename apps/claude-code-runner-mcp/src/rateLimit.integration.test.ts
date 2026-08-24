import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mockeamos todo lo que tocaría Docker/Postgres/git real para poder
// verificar, de forma determinista y sin contenedores/subprocesos reales,
// que el rate limiter impide un segundo `docker run` de tarea cuando el
// límite ya está ocupado — ver docs/hermes/spec.md §6.
//
// git.js se mockea también (no solo Docker/Postgres): shallowClone() hacía
// un `git clone` real por llamada, y bajo Promise.all() la variabilidad de
// timing de dos subprocesos de git concurrentes (más pronunciada en
// runners de CI compartidos) hacía que las dos llamadas a runCodingTask no
// llegaran a solaparse de forma fiable en el tryAcquire() del rate
// limiter — test flaky, verificado localmente (fallaba ~1 de cada 3
// ejecuciones). El mock crea el repo con llamadas SÍNCRONAS (execFileSync/
// mkdtempSync) — sin huecos async de por medio donde el event loop pueda
// intercalar las dos invocaciones en un orden no determinista — y sigue
// dejando un repo git real y válido (necesario: runCodingTask hace un
// `git rev-parse HEAD` real sobre el workspace justo después de clonar).
vi.mock('./git.js', () => ({
  shallowClone: vi.fn(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rate-limit-workspace-'));
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.local']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test']);
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'initial', '--allow-empty']);
    return dir;
  }),
  cleanupClone: vi.fn(async (dir: string) => rm(dir, { recursive: true, force: true })),
}));
vi.mock('./db.js', () => ({
  insertTaskRun: vi.fn().mockResolvedValue(null),
  finishTaskRun: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./session.js', () => ({
  checkSessionValid: vi.fn().mockResolvedValue({ valid: true }),
}));

const runTaskContainer = vi.fn();
vi.mock('./docker/runContainer.js', () => ({
  runTaskContainer: (...args: unknown[]) => runTaskContainer(...args),
  RUNNER_IMAGE: 'claude-code-runner-image:test',
}));

describe('rate limiting (integración, sin Docker real)', () => {
  let repoDir: string;

  beforeEach(async () => {
    // Ya no necesita ser un repo git real (shallowClone está mockeado) —
    // solo un `repo` no vacío para el input de la tool.
    repoDir = await mkdtemp(join(tmpdir(), 'rate-limit-repo-'));

    runTaskContainer.mockReset();
    runTaskContainer.mockImplementation(
      async () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                timedOut: false,
                exitCode: 0,
                logs: '',
                result: { status: 'success', summary: 'ok', commitShas: [] },
              }),
            50,
          );
        }),
    );
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it('rechaza una segunda tarea concurrente sin invocar runTaskContainer, y no la rechaza tras liberar el slot', async () => {
    const { runCodingTask } = await import('./runCodingTask.js');
    const { RateLimiter } = await import('./rateLimit.js');

    const rateLimiter = new RateLimiter({ maxConcurrent: 1, maxPerHour: 100 });
    const deps = { claudeCodeOauthToken: 'fake', rateLimiter, disableIsolation: true };

    const input = (n: number) => ({
      repo: repoDir,
      taskTitle: `Tarea ${n}`,
      taskDescription: 'x',
      timeoutSeconds: 30,
    });

    const [a, b] = await Promise.all([
      runCodingTask(input(1), deps),
      runCodingTask(input(2), deps),
    ]);

    const results = [a, b];
    const rejected = results.filter((r) => r.summary.includes('Límite de tareas'));
    const launched = results.filter((r) => !r.summary.includes('Límite de tareas'));

    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.status).toBe('needs_human_input');
    expect(launched).toHaveLength(1);
    // El rechazo no debe haber disparado un segundo docker run de tarea.
    expect(runTaskContainer).toHaveBeenCalledTimes(1);

    // Con el slot liberado, una tercera tarea sí se lanza.
    const c = await runCodingTask(input(3), deps);
    expect(c.summary.includes('Límite de tareas')).toBe(false);
    expect(runTaskContainer).toHaveBeenCalledTimes(2);
  });
});
