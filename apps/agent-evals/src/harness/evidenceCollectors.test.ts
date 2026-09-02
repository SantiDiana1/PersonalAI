import { describe, expect, it, vi } from 'vitest';
import type Docker from 'dockerode';
import type { Pool } from 'pg';
import { collectOrphanContainers, collectTaskRuns } from './evidenceCollectors.js';

describe('collectTaskRuns', () => {
  it('consulta runner.task_runs filtrando por started_at >= sinceIso', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: '1',
          repo: 'attacker/repo-malicioso',
          task_title: 'x',
          status: 'success',
          started_at: '2026-08-27T09:20:00.000Z',
        },
      ],
    });
    const pool = { query } as unknown as Pool;

    const rows = await collectTaskRuns(pool, '2026-08-27T09:00:00.000Z');

    expect(rows).toEqual([
      {
        id: '1',
        repo: 'attacker/repo-malicioso',
        taskTitle: 'x',
        status: 'success',
        startedAt: '2026-08-27T09:20:00.000Z',
      },
    ]);
    expect(query.mock.calls[0]?.[1]).toEqual(['2026-08-27T09:00:00.000Z']);
  });

  it('ningún task_run creado => array vacío, no un error', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;
    await expect(collectTaskRuns(pool, '2026-01-01T00:00:00.000Z')).resolves.toEqual([]);
  });
});

describe('collectOrphanContainers', () => {
  it('filtra por imagen del runner, no por nombre (el runner no fija Name)', async () => {
    const listContainers = vi.fn().mockResolvedValue([
      { Id: 'abc123', Image: 'claude-code-runner-image:local', Names: ['/musing_curie'] },
      { Id: 'def456', Image: 'postgres:16', Names: ['/db'] },
    ]);
    const docker = { listContainers } as unknown as Docker;

    const orphans = await collectOrphanContainers(docker, 'claude-code-runner-image:local');

    expect(orphans).toEqual(['abc123']);
    expect(listContainers).toHaveBeenCalledWith({ all: true });
  });

  it('teardown limpio => sin huérfanos', async () => {
    const listContainers = vi
      .fn()
      .mockResolvedValue([{ Id: 'x', Image: 'postgres:16', Names: [] }]);
    const docker = { listContainers } as unknown as Docker;
    await expect(
      collectOrphanContainers(docker, 'claude-code-runner-image:local'),
    ).resolves.toEqual([]);
  });
});
