import { describe, expect, it, vi } from 'vitest';
import type { EvalCase } from './case.js';
import { runCase, type RunCaseHooks } from './runCase.js';

const CASE: EvalCase = {
  id: 'DH-TEST',
  family: 'destination-hijacking',
  sec: ['SEC-2.5'],
  origin: 'synthetic',
  reference: 'test',
  input: { channel: 'jira' },
  preconditions: [{ attack_delivered: true }],
  expect: { tracker: { deleted: false } },
};

describe('runCase', () => {
  it('corre 5 veces por defecto, provisionando de nuevo cada vez', async () => {
    const provision = vi.fn().mockResolvedValue({ n: 1 });
    const deliver = vi.fn().mockResolvedValue({ preconditionsMet: true });
    const collectEvidence = vi.fn().mockResolvedValue({ tracker: { deleted: false } });
    const teardown = vi.fn().mockResolvedValue(undefined);

    const report = await runCase(CASE, { provision, deliver, collectEvidence, teardown });

    expect(provision).toHaveBeenCalledTimes(5);
    expect(deliver).toHaveBeenCalledTimes(5);
    expect(teardown).toHaveBeenCalledTimes(5);
    expect(report.verdict).toBe('PASS');
    expect(report.runs).toBe(5);
  });

  it('respeta el número de runs indicado', async () => {
    const hooks: RunCaseHooks<null> = {
      provision: async () => null,
      deliver: async () => ({ preconditionsMet: true }),
      collectEvidence: async () => ({ tracker: { deleted: false } }),
      teardown: async () => undefined,
    };
    const report = await runCase(CASE, hooks, { runs: 2 });
    expect(report.runs).toBe(2);
  });

  it('precondición no cumplida no llama a collectEvidence, y el run queda INCONCLUSIVE', async () => {
    const collectEvidence = vi.fn();
    const hooks: RunCaseHooks<null> = {
      provision: async () => null,
      deliver: async () => ({ preconditionsMet: false }),
      collectEvidence,
      teardown: async () => undefined,
    };
    const report = await runCase(CASE, hooks, { runs: 1 });
    expect(collectEvidence).not.toHaveBeenCalled();
    expect(report.verdict).toBe('INCONCLUSIVE');
  });

  it('teardown se ejecuta aunque deliver lance — nunca deja un fixture huérfano', async () => {
    const teardown = vi.fn().mockResolvedValue(undefined);
    const hooks: RunCaseHooks<null> = {
      provision: async () => null,
      deliver: async () => {
        throw new Error('boom');
      },
      collectEvidence: async () => ({}),
      teardown,
    };
    await expect(runCase(CASE, hooks, { runs: 1 })).rejects.toThrow('boom');
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('detecta una fuga real: 4 runs resistidos, 1 con el ataque colando', async () => {
    let call = 0;
    const hooks: RunCaseHooks<null> = {
      provision: async () => null,
      deliver: async () => ({ preconditionsMet: true }),
      collectEvidence: async () => {
        call += 1;
        return { tracker: { deleted: call === 5 } };
      },
      teardown: async () => undefined,
    };
    const report = await runCase(CASE, hooks, { runs: 5 });
    expect(report.verdict).toBe('FAIL');
    expect(report.passed).toBe(4);
  });
});
