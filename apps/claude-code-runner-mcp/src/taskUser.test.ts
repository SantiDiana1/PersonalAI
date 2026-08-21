import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveTaskUser, taskUserSpec } from './taskUser.js';

// `process.getuid`/`getgid` son opcionales en los tipos de Node (no existen en
// Windows), así que `vi.spyOn` los infiere como `never`. Este alias los declara
// presentes solo para el espía; no cambia el comportamiento en runtime.
const proc = process as unknown as { getuid: () => number; getgid: () => number };

const UID_VAR = 'CLAUDE_CODE_RUNNER_TASK_UID';
const GID_VAR = 'CLAUDE_CODE_RUNNER_TASK_GID';

describe('resolveTaskUser', () => {
  const originalUid = process.env[UID_VAR];
  const originalGid = process.env[GID_VAR];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of [
      [UID_VAR, originalUid],
      [GID_VAR, originalGid],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('NUNCA devuelve root, aunque el proceso sea root — claude rechaza --dangerously-skip-permissions como root', () => {
    delete process.env[UID_VAR];
    delete process.env[GID_VAR];
    vi.spyOn(proc, 'getuid').mockReturnValue(0);
    vi.spyOn(proc, 'getgid').mockReturnValue(0);

    const user = resolveTaskUser();
    expect(user.uid).not.toBe(0);
    expect(user.gid).not.toBe(0);
    expect(user).toEqual({ uid: 1001, gid: 1001 });
  });

  it('hereda el uid del proceso cuando NO es root — comportamiento de la Fase 1 en el host', () => {
    delete process.env[UID_VAR];
    delete process.env[GID_VAR];
    vi.spyOn(proc, 'getuid').mockReturnValue(1000);
    vi.spyOn(proc, 'getgid').mockReturnValue(1000);

    expect(resolveTaskUser()).toEqual({ uid: 1000, gid: 1000 });
  });

  it('respeta el override explícito por entorno', () => {
    process.env[UID_VAR] = '1234';
    process.env[GID_VAR] = '5678';
    vi.spyOn(proc, 'getuid').mockReturnValue(0);

    expect(resolveTaskUser()).toEqual({ uid: 1234, gid: 5678 });
  });

  it('usa el uid como gid si solo se configura el uid', () => {
    process.env[UID_VAR] = '1234';
    delete process.env[GID_VAR];

    expect(resolveTaskUser()).toEqual({ uid: 1234, gid: 1234 });
  });

  it('ignora overrides inválidos, incluido un 0 explícito, en vez de acabar en root', () => {
    vi.spyOn(proc, 'getuid').mockReturnValue(0);
    vi.spyOn(proc, 'getgid').mockReturnValue(0);

    for (const raw of ['0', '-5', 'root', '', '   ']) {
      process.env[UID_VAR] = raw;
      expect(resolveTaskUser().uid).toBe(1001);
    }
  });

  it('formatea uid:gid como espera Docker', () => {
    expect(taskUserSpec({ uid: 1001, gid: 1001 })).toBe('1001:1001');
  });
});
