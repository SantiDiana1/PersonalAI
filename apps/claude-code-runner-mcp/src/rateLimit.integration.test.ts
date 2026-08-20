import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);

// Mockeamos todo lo que tocaría Docker/Postgres para poder verificar, sin
// contenedores reales, que el rate limiter impide un segundo `docker run`
// de tarea cuando el límite ya está ocupado — ver docs/hermes/spec.md §6.
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
    repoDir = await mkdtemp(join(tmpdir(), 'rate-limit-repo-'));
    await execFileAsync('git', ['init', '-q', '-b', 'main', repoDir]);
    await execFileAsync('git', ['-C', repoDir, 'config', 'user.email', 'test@test.local']);
    await execFileAsync('git', ['-C', repoDir, 'config', 'user.name', 'Test']);
    await writeFile(join(repoDir, 'README.md'), '# demo\n');
    await execFileAsync('git', ['-C', repoDir, 'add', '.']);
    await execFileAsync('git', ['-C', repoDir, 'commit', '-qm', 'initial']);

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
