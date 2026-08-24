import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from './logger.js';
import { runCodingTask, type RunCodingTaskDeps } from './runCodingTask.js';
import { checkSessionValid } from './session.js';
import { getRunnerStatusSummary } from './db.js';
import { ensureIsolation } from './docker/network.js';
import type { RunCodingTaskInput } from './types.js';

const RUN_CODING_TASK_INPUT_SHAPE = {
  repo: z.string().describe('owner/repo'),
  baseBranch: z.string().optional(),
  taskTitle: z.string(),
  taskDescription: z.string(),
  brainContext: z.string().optional(),
  timeoutSeconds: z.number().int().positive().optional(),
};

export function loadDeps(): RunCodingTaskDeps {
  const claudeCodeOauthToken = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  if (!claudeCodeOauthToken) {
    throw new Error(
      'CLAUDE_CODE_OAUTH_TOKEN no está configurada — ver docs/hermes/spec.md §0.1/§0.3 (secreto hermes-claude-auth).',
    );
  }
  const githubToken = process.env['GITHUB_TOKEN'];
  // Sin overrides explícitos, runCodingTask() calcula el aislamiento de red
  // automáticamente (docs/hermes/spec.md §3.4) vía ensureIsolation(). Estas
  // variables solo existen como escape hatch para despliegues no estándar.
  const networkMode = process.env['CLAUDE_CODE_RUNNER_NETWORK'];
  const httpProxyUrl = process.env['CLAUDE_CODE_RUNNER_PROXY_URL'];
  const disableIsolation = process.env['CLAUDE_CODE_RUNNER_DISABLE_ISOLATION'] === '1';
  if (disableIsolation) {
    logger.warn(
      'CLAUDE_CODE_RUNNER_DISABLE_ISOLATION=1 — aislamiento de red desactivado, NUNCA usar en producción',
    );
  }
  return {
    claudeCodeOauthToken,
    ...(githubToken ? { githubToken } : {}),
    ...(networkMode ? { networkMode } : {}),
    ...(httpProxyUrl ? { httpProxyUrl } : {}),
    ...(disableIsolation ? { disableIsolation } : {}),
  };
}

/**
 * Construye una instancia del servidor MCP con las dos tools que este
 * servidor expone.
 *
 * La superficie sigue siendo deliberadamente mínima y tipada (SEC-3.3 de
 * docs/security.md): no existe, ni debe existir, ninguna tool de propósito
 * general tipo "ejecuta este comando" — este proceso es el único del sistema
 * con acceso al socket de Docker, así que cualquier operación que exponga es,
 * en la práctica, ejecutable por quien controle al cliente MCP.
 *
 * `get_runner_status` (US-6.3/US-6.4 de docs/roadmap.md — Fase 6) es la
 * segunda tool, añadida deliberadamente como excepción acotada a "una sola
 * tool": es de solo lectura (no lanza contenedores de tarea, no toca
 * `/var/run/docker.sock` salvo el mismo contenedor de comprobación de sesión
 * efímero que ya usa `run_coding_task`) y sin parámetros — no amplía la
 * superficie de ataque de la misma forma que un `run_shell_command` genérico.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'claude-code-runner-mcp', version: '0.1.0' });

  server.registerTool(
    'run_coding_task',
    {
      title: 'run_coding_task',
      description:
        'Delega una tarea de código a Claude Code, ejecutado de forma aislada en un ' +
        'contenedor Docker efímero por tarea. Ver docs/hermes/spec.md §3.',
      inputSchema: RUN_CODING_TASK_INPUT_SHAPE,
    },
    async (input) => {
      logger.info({ repo: input.repo, taskTitle: input.taskTitle }, 'run_coding_task recibida');
      const deps = loadDeps();
      const taskInput: RunCodingTaskInput = {
        repo: input.repo,
        taskTitle: input.taskTitle,
        taskDescription: input.taskDescription,
        ...(input.baseBranch !== undefined ? { baseBranch: input.baseBranch } : {}),
        ...(input.brainContext !== undefined ? { brainContext: input.brainContext } : {}),
        ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {}),
      };
      const output = await runCodingTask(taskInput, deps);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(output) }],
      };
    },
  );

  server.registerTool(
    'get_runner_status',
    {
      title: 'get_runner_status',
      description:
        'Resumen de solo lectura del estado operativo del runner: validez de la sesión ' +
        'de Claude Code compartida (hermes-claude-auth), tareas recientes en ' +
        'needs_human_input/failed, y consumo aproximado (número de tareas lanzadas, no ' +
        'telemetría real de Anthropic) de las ventanas de 5h/7 días. Usado por los skills ' +
        'status-report (a demanda) y por el cron de resumen periódico (US-6.3/US-6.4).',
      inputSchema: {},
    },
    async () => {
      logger.info('get_runner_status recibida');
      const deps = loadDeps();
      const isolation = await ensureIsolation().catch((err: unknown) => {
        logger.warn(
          { err },
          'no se pudo calcular el aislamiento de red para la comprobación de sesión',
        );
        return {};
      });
      const [sessionCheck, summary] = await Promise.all([
        checkSessionValid(deps.claudeCodeOauthToken, isolation),
        getRunnerStatusSummary(),
      ]);
      const output = {
        session: sessionCheck,
        persistenceAvailable: summary !== null,
        tasksNeedingAttention: summary?.tasksNeedingAttention ?? [],
        tasksStartedLast5h: summary?.tasksStartedLast5h ?? null,
        tasksStartedLast7d: summary?.tasksStartedLast7d ?? null,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(output) }],
      };
    },
  );

  return server;
}
