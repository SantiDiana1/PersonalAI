/**
 * Acceso a Docker acotado EN CÓDIGO, no en el socket — Fase 15 (US-15.2).
 *
 * Esto es una ampliación de privilegio real y deliberada, documentada en
 * docs/security.md SEC-1.6: este bot pasa de "sin socket de Docker" a poder
 * hablar con el demonio. Lo que lo mantiene acotado no es el socket —quien lo
 * tiene puede en principio hacer cualquier cosa con él, es la llave maestra
 * del host (SEC-1)— sino que este módulo es el ÚNICO lugar donde vive esa
 * capacidad, y solo sabe hacer tres cosas, siempre contra el mismo contenedor
 * por nombre fijo:
 *
 *   1. Leer el modelo/proveedor activo (`hermes config show`, de solo lectura,
 *      y que ya redacta las claves API — verificado, no asumido).
 *   2. Cambiarlo (`hermes config set model.provider|model.default <valor>`).
 *   3. Reiniciar ese contenedor para que la config nueva se cargue.
 *
 * Nunca un comando arbitrario, nunca otro contenedor, nunca `exec` con lo que
 * escriba el Operador sin pasar antes por la validación de `modelChoices.ts`
 * contra la lista declarada — igual que `providers.ts` sondea eslabones
 * DECLARADOS y no la cadena viva, este módulo actúa sobre un catálogo
 * declarado, nunca sobre un valor libre.
 */
import type Docker from 'dockerode';

export class DockerOperationError extends Error {}

/** Ruta real del binario de hermes dentro de su propio contenedor. */
const HERMES_BIN = '/opt/hermes/.venv/bin/hermes';

async function execAndCollect(
  container: Docker.Container,
  cmd: string[],
): Promise<{ exitCode: number | null; output: string }> {
  const exec = await container.exec({
    Cmd: cmd,
    // Mismo usuario no-root que usa el propio Operador al invocar `hermes`
    // a mano (ver hallazgo de la Fase 2 sobre jobs.json quedando de root).
    User: 'hermes',
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const output = Buffer.concat(chunks).toString('utf8');
  const inspect = await exec.inspect();
  return { exitCode: inspect.ExitCode, output };
}

/**
 * Lee el eslabón activo real ejecutando `hermes config show` — el mismo
 * comando de solo lectura que ya usaba el Operador a mano, verificado que
 * redacta las claves API antes de imprimirlas (nunca vuelca `auth.json` ni
 * los tokens de los servidores MCP embebidos en `config.yaml`).
 */
export async function readActiveModel(
  docker: Docker,
  containerName: string,
): Promise<{ provider: string; model: string }> {
  const container = docker.getContainer(containerName);
  const { exitCode, output } = await execAndCollect(container, [HERMES_BIN, 'config', 'show']);
  if (exitCode !== 0) {
    throw new DockerOperationError(
      `'hermes config show' terminó con código ${String(exitCode)}: ${output.slice(0, 500)}`,
    );
  }
  // La línea real es: "  Model:        {'default': 'claude-...', 'provider': 'anthropic'}"
  const match = /Model:\s*\{[^}]*'default':\s*'([^']+)'[^}]*'provider':\s*'([^']+)'/.exec(output);
  if (!match) {
    throw new DockerOperationError(
      "No se pudo leer el modelo activo de la salida de 'hermes config show' — puede que el " +
        'formato haya cambiado en una actualización de hermes-agent.',
    );
  }
  const [, model, provider] = match as unknown as [string, string, string];
  return { provider, model };
}

/**
 * Cambia el eslabón activo con `hermes config set`, dos llamadas secuenciales
 * porque el CLI solo acepta una clave por invocación (verificado con
 * `hermes config set --help`). No reinicia por sí sola — ver
 * `restartHermesContainer`.
 */
export async function setActiveModel(
  docker: Docker,
  containerName: string,
  provider: string,
  model: string,
): Promise<void> {
  const container = docker.getContainer(containerName);
  for (const [key, value] of [
    ['model.provider', provider],
    ['model.default', model],
  ] as const) {
    const { exitCode, output } = await execAndCollect(container, [
      HERMES_BIN,
      'config',
      'set',
      key,
      value,
    ]);
    if (exitCode !== 0) {
      throw new DockerOperationError(
        `'hermes config set ${key} ${value}' terminó con código ${String(exitCode)}: ` +
          output.slice(0, 500),
      );
    }
  }
}

/**
 * Reinicia el contenedor de Hermes para que recoja el `config.yaml` que
 * acaba de cambiar — el gateway solo lo carga al arrancar (mismo hallazgo
 * operacional de la Fase 2/13). Equivalente a `docker compose restart hermes`
 * pero vía la API de Docker directamente, sin depender de que el compose CLI
 * exista dentro de este contenedor.
 */
export async function restartHermesContainer(docker: Docker, containerName: string): Promise<void> {
  const container = docker.getContainer(containerName);
  await container.restart();
}
