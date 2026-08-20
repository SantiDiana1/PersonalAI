import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { migrate } from './db.js';
import { logger } from './logger.js';
import { runCodingTask, type RunCodingTaskDeps } from './runCodingTask.js';
import type { RunCodingTaskInput } from './types.js';

const RUN_CODING_TASK_INPUT_SHAPE = {
  repo: z.string().describe('owner/repo'),
  baseBranch: z.string().optional(),
  taskTitle: z.string(),
  taskDescription: z.string(),
  brainContext: z.string().optional(),
  timeoutSeconds: z.number().int().positive().optional(),
};

function loadDeps(): RunCodingTaskDeps {
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

export async function startServer(): Promise<void> {
  await migrate();

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
        content: [{ type: 'text', text: JSON.stringify(output) }],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('claude-code-runner-mcp escuchando por stdio');
}
