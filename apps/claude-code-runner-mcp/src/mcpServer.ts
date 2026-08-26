import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from './logger.js';
import { runCodingTask, type RunCodingTaskDeps } from './runCodingTask.js';
import { runClaudeCommand, type RunClaudeCommandDeps } from './runClaudeCommand.js';
import { checkSessionValid } from './session.js';
import { getMetrics, getRunnerStatusSummary } from './db.js';
import { ensureIsolation } from './docker/network.js';
import {
  ALLOWED_SLASH_COMMANDS,
  type RunClaudeCommandInput,
  type RunCodingTaskInput,
} from './types.js';

const RUN_CODING_TASK_INPUT_SHAPE = {
  repo: z.string().describe('owner/repo'),
  baseBranch: z.string().optional(),
  taskTitle: z.string(),
  taskDescription: z.string(),
  brainContext: z.string().optional(),
  timeoutSeconds: z.number().int().positive().optional(),
};

const RUN_CLAUDE_COMMAND_INPUT_SHAPE = {
  slashCommand: z
    .enum(ALLOWED_SLASH_COMMANDS)
    .describe(`Comando slash a ejecutar. Allowlist fija: ${ALLOWED_SLASH_COMMANDS.join(', ')}.`),
  prompt: z
    .string()
    .describe('Texto libre tras el comando, p.ej. "landing page para mi proyecto X".'),
  repo: z
    .string()
    .optional()
    .describe(
      'owner/repo, solo si el comando necesita contexto de un repo (clonado read-only, sin push).',
    ),
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
  // Solo la usa run_claude_command (ver RunClaudeCommandDeps::artifactsDir) —
  // sin configurar, esa tool sigue funcionando, solo sin adjunto real de
  // Telegram (cae al fallback de htmlContent como texto).
  const artifactsDir = process.env['CLAUDE_CODE_RUNNER_ARTIFACTS_DIR'];
  return {
    claudeCodeOauthToken,
    ...(githubToken ? { githubToken } : {}),
    ...(networkMode ? { networkMode } : {}),
    ...(httpProxyUrl ? { httpProxyUrl } : {}),
    ...(disableIsolation ? { disableIsolation } : {}),
    ...(artifactsDir ? { artifactsDir } : {}),
  };
}

/**
 * Construye una instancia del servidor MCP con las tools que este servidor
 * expone.
 *
 * La superficie sigue siendo deliberadamente mínima y tipada (SEC-3.3 de
 * docs/security.md): no existe, ni debe existir, ninguna tool de propósito
 * general tipo "ejecuta este comando" — este proceso es el único del sistema
 * con acceso al socket de Docker, así que cualquier operación que exponga es,
 * en la práctica, ejecutable por quien controle al cliente MCP.
 *
 * `get_runner_status` (US-6.3/US-6.4 de docs/roadmap.md — Fase 6) y
 * `get_metrics` (US-9.2 — Fase 9) son excepciones acotadas: ambas son de solo
 * lectura y sin parámetros — no amplían la superficie de ataque de la forma
 * en que lo haría un `run_shell_command` genérico. `get_runner_status` no
 * toca `/var/run/docker.sock` salvo por el mismo contenedor de comprobación
 * de sesión efímero que ya usa `run_coding_task`; `get_metrics` no lo toca en
 * absoluto — solo hace SELECTs agregados contra Postgres.
 *
 * Que `get_metrics` no reciba parámetros es deliberado y no una simplificación
 * pendiente de ampliar: en cuanto aceptara un filtro en texto libre pasaría a
 * ser una superficie por la que colar SQL o exfiltrar filas concretas desde un
 * mensaje de Telegram. Devuelve agregados fijos, nunca contenido de tareas.
 *
 * `run_claude_command` (Fase 8, US-8.2) es la segunda tool que sí lanza
 * contenedores — deliberadamente separada de `run_coding_task` (contrato de
 * resultado distinto, HTML en vez de rama con commits — ver types.ts) pero
 * con el mismo aislamiento, misma sesión compartida y mismo rate limiting.
 * Su `slashCommand` está validado contra ALLOWED_SLASH_COMMANDS, no acepta
 * texto libre — mismo principio de "superficie exactamente esta lista", no
 * un intérprete de comandos arbitrario expuesto a texto no confiable.
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
    'run_claude_command',
    {
      title: 'run_claude_command',
      description:
        'Ejecuta un comando slash de Claude Code (allowlist fija: ' +
        `${ALLOWED_SLASH_COMMANDS.join(', ')}) en un contenedor efímero, igual de aislado que ` +
        'run_coding_task. Devuelve el HTML autocontenido generado (htmlContent), NUNCA un link ' +
        'ya publicado a claude.ai — la tool Artifact no está disponible en modo headless. Si ' +
        'CLAUDE_CODE_RUNNER_ARTIFACTS_DIR está configurada, también devuelve htmlFilePath: ' +
        'úsalo con el tag MEDIA:<ruta> del gateway de Telegram para entregar un adjunto real y ' +
        'abrible, no pegues htmlContent como texto. Ver docs/hermes/spec.md §3.7.',
      inputSchema: RUN_CLAUDE_COMMAND_INPUT_SHAPE,
    },
    async (input) => {
      logger.info({ slashCommand: input.slashCommand }, 'run_claude_command recibida');
      const deps: RunClaudeCommandDeps = loadDeps();
      const commandInput: RunClaudeCommandInput = {
        slashCommand: input.slashCommand,
        prompt: input.prompt,
        ...(input.repo !== undefined ? { repo: input.repo } : {}),
        ...(input.brainContext !== undefined ? { brainContext: input.brainContext } : {}),
        ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {}),
      };
      const output = await runClaudeCommand(commandInput, deps);
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

  server.registerTool(
    'get_metrics',
    {
      title: 'get_metrics',
      description:
        'Métricas acumuladas de uso real del sistema, de solo lectura y sin parámetros: ' +
        'tareas resueltas y tasa de éxito POR TOOL (run_coding_task frente a ' +
        'run_claude_command, que fallan por motivos distintos), tareas iniciadas en las ' +
        'ventanas de 5h/7d/30d, y eventos ingestados en Brain con desglose por fuente. ' +
        'Mismo dato que imprime el CLI `personalai-metrics`. Distinta de ' +
        'get_runner_status: esa responde "¿está todo bien AHORA?" (sesión, tareas ' +
        'atascadas), esta responde "¿cuánto se ha usado esto?". Usada por el skill ' +
        'status-report cuando el Operador pide métricas o números.',
      inputSchema: {},
    },
    async () => {
      logger.info('get_metrics recibida');
      const metrics = await getMetrics();
      const output = {
        persistenceAvailable: metrics !== null,
        metrics,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(output) }],
      };
    },
  );

  return server;
}
