import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Servidor MCP de Jira **fake**, registrable en el lugar de
 * `@aashari/mcp-server-atlassian-jira` para un run de la suite.
 *
 * Por qué existe este fichero y no basta con `JiraStub` (fixtures/jiraStub.ts):
 * el servidor MCP de Jira real, igual que el de GitHub, tiene su URL fija en
 * código — `https://${ATLASSIAN_SITE_NAME}.atlassian.net`, verificado
 * leyendo `utils/transport.util.js` del paquete instalado. No hay ninguna
 * variable de entorno para redirigirlo a `http://127.0.0.1:<puerto>`. Así
 * que un `JiraStub` HTTP por sí solo es invisible para hermes-agent: nada en
 * su configuración real sabría hablar con él.
 *
 * La solución no es más HTTP, es este fichero: un servidor MCP propio,
 * mínimo, que expone **los mismos cinco nombres de tool** que el real
 * (`jira_get`, `jira_post`, `jira_put`, `jira_patch`, `jira_delete`) con la
 * misma forma de argumentos (`{ path, body? }`, verificado contra
 * `tools/atlassian.api.tool.js` del paquete real), y cada uno reenvía la
 * llamada al `JiraStub` en vez de a Atlassian. Para hermes-agent y para el
 * skill `resolve-jira-task`, esto es indistinguible del servidor real — la
 * suite sigue cumpliendo §7.2 del spec ("deliver through the real channel"):
 * el input viaja por el mismo camino de tool-calls MCP que un ataque real
 * usaría, solo que el otro extremo es desechable.
 *
 * A diferencia del servidor real, `jira_delete` y `jira_patch` SÍ están
 * implementados aquí (reenvían igual que los demás) — a propósito: si el
 * agente los llama, TM-001 tiene que poder verlo. Es `JiraStub`, no este
 * fichero, quien decide que esas rutas devuelvan 404 (fuera de su
 * allowlist), exactamente igual que lo haría intentar borrar un proyecto
 * inexistente contra la Jira real.
 */

const READ_ARGS = {
  path: z.string().describe('Ruta REST, ej. /rest/api/3/issue/MYAI-11'),
  queryParams: z.record(z.string()).optional(),
};

const WRITE_ARGS = {
  path: z.string().describe('Ruta REST, ej. /rest/api/3/issue/MYAI-11/transitions'),
  body: z.unknown().optional(),
};

export function createJiraFixtureMcpServer(stubBaseUrl: string): McpServer {
  const server = new McpServer({ name: 'jira-fixture', version: '0.0.0' });

  const registerRead = (name: string, method: 'GET' | 'DELETE') => {
    server.registerTool(
      name,
      {
        description: `[fixture] ${method} contra el JiraStub desechable, nunca Atlassian real.`,
        inputSchema: READ_ARGS,
      },
      async (args) => forward(stubBaseUrl, method, args.path),
    );
  };

  const registerWrite = (name: string, method: 'POST' | 'PUT' | 'PATCH') => {
    server.registerTool(
      name,
      {
        description: `[fixture] ${method} contra el JiraStub desechable, nunca Atlassian real.`,
        inputSchema: WRITE_ARGS,
      },
      async (args) => forward(stubBaseUrl, method, args.path, args.body),
    );
  };

  registerRead('jira_get', 'GET');
  registerWrite('jira_post', 'POST');
  registerWrite('jira_put', 'PUT');
  registerWrite('jira_patch', 'PATCH');
  registerRead('jira_delete', 'DELETE');

  return server;
}

async function forward(
  stubBaseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(`${stubBaseUrl}${path}`, init);
  const text = res.status === 204 ? '' : await res.text();
  return {
    content: [{ type: 'text', text: `HTTP ${String(res.status)}\n${text}` }],
  };
}
