import Docker from 'dockerode';
import { logger } from '../logger.js';

/**
 * Aislamiento de red de los contenedores de tarea — docs/hermes/spec.md §3.4:
 * "su red está restringida a una allowlist (api.anthropic.com, github.com)
 * ... sin acceso libre a Internet".
 *
 * Mecanismo: los contenedores de tarea se conectan SOLO a una red Docker
 * `internal: true` (sin ruta de salida a Internet). La única salida es un
 * proxy HTTP/HTTPS (`claude-code-runner-proxy`, tinyproxy con allowlist),
 * que además está conectado a una red normal con salida real. El contenedor
 * de tarea recibe HTTP_PROXY/HTTPS_PROXY apuntando a ese proxy — nunca tiene
 * ruta directa a Internet.
 */
export const INTERNAL_NETWORK =
  process.env['CLAUDE_CODE_RUNNER_INTERNAL_NETWORK'] ?? 'claude-code-runner-internal';
const EGRESS_NETWORK =
  process.env['CLAUDE_CODE_RUNNER_EGRESS_NETWORK'] ?? 'claude-code-runner-egress';
const PROXY_CONTAINER_NAME =
  process.env['CLAUDE_CODE_RUNNER_PROXY_NAME'] ?? 'claude-code-runner-proxy';
const PROXY_IMAGE =
  process.env['CLAUDE_CODE_RUNNER_PROXY_IMAGE'] ?? 'claude-code-runner-proxy:local';
const PROXY_PORT = 8888;

export interface IsolationSetup {
  networkMode: string;
  httpProxyUrl: string;
}

async function ensureNetwork(docker: Docker, name: string, internal: boolean): Promise<void> {
  const networks = await docker.listNetworks({ filters: JSON.stringify({ name: [name] }) });
  if (networks.some((n) => n.Name === name)) return;
  await docker.createNetwork({ Name: name, Driver: 'bridge', Internal: internal });
  logger.info({ name, internal }, 'red Docker de aislamiento creada');
}

async function ensureProxyRunning(docker: Docker): Promise<string> {
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ name: [`^/${PROXY_CONTAINER_NAME}$`] }),
  });
  const existing = containers[0];

  if (existing && existing.State === 'running') {
    return PROXY_CONTAINER_NAME;
  }

  if (existing) {
    await docker.getContainer(existing.Id).remove({ force: true });
  }

  const container = await docker.createContainer({
    name: PROXY_CONTAINER_NAME,
    Image: PROXY_IMAGE,
    HostConfig: { NetworkMode: EGRESS_NETWORK, RestartPolicy: { Name: 'unless-stopped' } },
  });
  await container.start();
  const internalNetwork = docker.getNetwork(INTERNAL_NETWORK);
  await internalNetwork.connect({ Container: container.id });
  logger.info({ container: PROXY_CONTAINER_NAME }, 'proxy de egreso con allowlist arrancado');
  return PROXY_CONTAINER_NAME;
}

/**
 * Garantiza que existen las redes y el proxy de allowlist, y devuelve las
 * opciones a pasar a `runTaskContainer`/`checkSessionValid` para que el
 * contenedor de tarea quede en la red interna sin salida directa.
 */
export async function ensureIsolation(): Promise<IsolationSetup> {
  const docker = new Docker();
  await ensureNetwork(docker, EGRESS_NETWORK, false);
  await ensureNetwork(docker, INTERNAL_NETWORK, true);
  const proxyName = await ensureProxyRunning(docker);
  return {
    networkMode: INTERNAL_NETWORK,
    httpProxyUrl: `http://${proxyName}:${String(PROXY_PORT)}`,
  };
}
