import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import type Docker from 'dockerode';
import {
  DockerOperationError,
  createDeterministicTask,
  readActiveModel,
  restartHermesContainer,
  setActiveModel,
} from './docker.js';

const CONTAINER_NAME = 'personalai-hermes-1';

/**
 * Fake mínimo de la superficie real de dockerode que usa docker.ts: no
 * reimplementa el cliente entero, solo lo que `execAndCollect` y
 * `restartHermesContainer` de verdad llaman.
 */
function fakeDocker(execResponses: { exitCode: number; output: string }[]): {
  docker: Docker;
  execCalls: { name: string; cmd: string[]; user: string | undefined }[];
  restartCalls: string[];
} {
  const execCalls: { name: string; cmd: string[]; user: string | undefined }[] = [];
  const restartCalls: string[] = [];
  let call = 0;

  const docker = {
    getContainer(name: string) {
      return {
        async exec(opts: { Cmd: string[]; User?: string }) {
          execCalls.push({ name, cmd: opts.Cmd, user: opts.User });
          const response = execResponses[call] ?? { exitCode: 0, output: '' };
          call += 1;
          return {
            async start() {
              return Readable.from([Buffer.from(response.output, 'utf8')]);
            },
            async inspect() {
              return { ExitCode: response.exitCode };
            },
          };
        },
        async restart() {
          restartCalls.push(name);
        },
      };
    },
  } as unknown as Docker;

  return { docker, execCalls, restartCalls };
}

describe('readActiveModel', () => {
  it('parsea provider y model de la salida real de "hermes config show"', async () => {
    const output = [
      '◆ Model',
      "  Model:        {'default': 'claude-sonnet-4-5-20250929', 'provider': 'anthropic'}",
      '  Max turns:    90',
    ].join('\n');
    const { docker, execCalls } = fakeDocker([{ exitCode: 0, output }]);

    const result = await readActiveModel(docker, CONTAINER_NAME);

    expect(result).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' });
    expect(execCalls[0]?.cmd).toEqual(['/opt/hermes/.venv/bin/hermes', 'config', 'show']);
    expect(execCalls[0]?.user).toBe('hermes');
    expect(execCalls[0]?.name).toBe(CONTAINER_NAME);
  });

  it('lanza DockerOperationError si el exit code no es 0', async () => {
    const { docker } = fakeDocker([{ exitCode: 1, output: 'algo falló' }]);
    await expect(readActiveModel(docker, CONTAINER_NAME)).rejects.toThrow(DockerOperationError);
  });

  it('lanza DockerOperationError si la salida no tiene la forma esperada (formato cambiado upstream)', async () => {
    const { docker } = fakeDocker([{ exitCode: 0, output: 'salida irreconocible sin Model:' }]);
    await expect(readActiveModel(docker, CONTAINER_NAME)).rejects.toThrow(DockerOperationError);
  });
});

describe('setActiveModel', () => {
  it('ejecuta dos llamadas secuenciales, una por clave', async () => {
    const { docker, execCalls } = fakeDocker([
      { exitCode: 0, output: '' },
      { exitCode: 0, output: '' },
    ]);

    await setActiveModel(docker, CONTAINER_NAME, 'openrouter', 'minimax/minimax-m3:free');

    expect(execCalls).toHaveLength(2);
    expect(execCalls[0]?.cmd).toEqual([
      '/opt/hermes/.venv/bin/hermes',
      'config',
      'set',
      'model.provider',
      'openrouter',
    ]);
    expect(execCalls[1]?.cmd).toEqual([
      '/opt/hermes/.venv/bin/hermes',
      'config',
      'set',
      'model.default',
      'minimax/minimax-m3:free',
    ]);
  });

  it('lanza DockerOperationError si cualquiera de las dos llamadas falla', async () => {
    const { docker } = fakeDocker([{ exitCode: 1, output: 'clave inválida' }]);
    await expect(
      setActiveModel(docker, CONTAINER_NAME, 'proveedor-malo', 'modelo'),
    ).rejects.toThrow(DockerOperationError);
  });
});

describe('restartHermesContainer', () => {
  it('reinicia exactamente el contenedor por nombre, nada más', async () => {
    const { docker, restartCalls } = fakeDocker([]);
    await restartHermesContainer(docker, CONTAINER_NAME);
    expect(restartCalls).toEqual([CONTAINER_NAME]);
  });
});

describe('createDeterministicTask', () => {
  it('ejecuta hermes cron create con los flags fijos, como el usuario hermes', async () => {
    const { docker, execCalls } = fakeDocker([{ exitCode: 0, output: '' }]);

    await createDeterministicTask(docker, CONTAINER_NAME, {
      name: 'tarea-WEB-6-123',
      skill: 'resolve-jira-task',
      prompt: 'Ticket de Jira ya seleccionado, sin búsqueda: WEB-6.',
      deliver: 'telegram:42',
      schedule: '2026-09-01T12:00:10.000Z',
    });

    expect(execCalls[0]?.cmd).toEqual([
      '/opt/hermes/.venv/bin/hermes',
      'cron',
      'create',
      '2026-09-01T12:00:10.000Z',
      '--name',
      'tarea-WEB-6-123',
      '--skill',
      'resolve-jira-task',
      '--deliver',
      'telegram:42',
      'Ticket de Jira ya seleccionado, sin búsqueda: WEB-6.',
    ]);
    expect(execCalls[0]?.user).toBe('hermes');
  });

  it('lanza DockerOperationError si el exit code no es 0', async () => {
    const { docker } = fakeDocker([{ exitCode: 1, output: 'clave de skill desconocida' }]);
    await expect(
      createDeterministicTask(docker, CONTAINER_NAME, {
        name: 'tarea-WEB-6-123',
        skill: 'resolve-jira-task',
        prompt: 'x',
        deliver: 'telegram:42',
        schedule: '2026-09-01T12:00:10.000Z',
      }),
    ).rejects.toThrow(DockerOperationError);
  });
});

// No es un test, es documentación ejecutable de la promesa de "acotado en
// código": la única forma de llegar al demonio de Docker desde este módulo es
// vía `docker.getContainer(name).exec/.restart` — nunca `docker.run`,
// `docker.createContainer`, ni ningún otro método de la API de Docker con
// alcance más amplio que "un contenedor concreto, por nombre".
describe('superficie del módulo', () => {
  it('no expone ninguna función más allá de las tres documentadas', async () => {
    const mod = await import('./docker.js');
    const exportedFunctions = Object.keys(mod).filter(
      (k) => typeof mod[k as keyof typeof mod] === 'function',
    );
    expect(exportedFunctions.sort()).toEqual(
      [
        'DockerOperationError',
        'createDeterministicTask',
        'readActiveModel',
        'restartHermesContainer',
        'setActiveModel',
      ].sort(),
    );
  });
});
