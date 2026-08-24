import { beforeEach, describe, expect, it, vi } from 'vitest';

// ensureIsolation() se invoca una vez por tarea (runCodingTask.ts); estas
// redes/proxy son estables durante la vida del proceso, así que solo la
// primera llamada debe consultar/crear cosas en Docker — ver network.ts.
const listNetworks = vi.fn().mockResolvedValue([]);
const createNetwork = vi.fn().mockResolvedValue(undefined);
const listContainers = vi.fn().mockResolvedValue([]);
const createContainer = vi.fn().mockResolvedValue({
  id: 'proxy-container-id',
  start: vi.fn().mockResolvedValue(undefined),
});
const getNetwork = vi.fn().mockReturnValue({ connect: vi.fn().mockResolvedValue(undefined) });

vi.mock('dockerode', () => ({
  default: vi.fn().mockImplementation(() => ({
    listNetworks,
    createNetwork,
    listContainers,
    createContainer,
    getNetwork,
    getContainer: vi.fn(),
  })),
}));

describe('ensureIsolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('memoiza la configuración: solo consulta Docker en la primera llamada', async () => {
    const { ensureIsolation } = await import('./network.js');

    const first = await ensureIsolation();
    const second = await ensureIsolation();

    expect(second).toEqual(first);
    // 2 redes (egress + internal), comprobadas una sola vez en total.
    expect(listNetworks).toHaveBeenCalledTimes(2);
    expect(listContainers).toHaveBeenCalledTimes(1);
    expect(createContainer).toHaveBeenCalledTimes(1);
  });

  it('llamadas concurrentes comparten la misma promesa en curso (una sola consulta)', async () => {
    const { ensureIsolation } = await import('./network.js');

    const [a, b] = await Promise.all([ensureIsolation(), ensureIsolation()]);

    expect(b).toEqual(a);
    expect(listContainers).toHaveBeenCalledTimes(1);
  });

  it('si falla, no memoiza el error: la siguiente llamada reintenta contra Docker', async () => {
    listContainers.mockRejectedValueOnce(new Error('docker daemon no disponible'));
    const { ensureIsolation } = await import('./network.js');

    await expect(ensureIsolation()).rejects.toThrow('docker daemon no disponible');
    await expect(ensureIsolation()).resolves.toMatchObject({
      networkMode: expect.any(String),
    });
    expect(listContainers).toHaveBeenCalledTimes(2);
  });
});
