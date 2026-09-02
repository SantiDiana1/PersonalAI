#!/usr/bin/env node
/**
 * Entrypoint que hermes-agent lanza en el lugar de
 * `npx -y @aashari/mcp-server-atlassian-jira` durante un run de la suite
 * (registrado con `command: node`, `args: [.../jiraMcpServer.bin.js]` en la
 * config de la instancia de eval — ver docs/agent-evals/spec.md §9).
 *
 * Autocontenido a propósito: levanta su propio `JiraStub` en
 * `127.0.0.1:<puerto efímero>` DENTRO de este mismo subproceso — nada de
 * red externa, ni siquiera dentro del mismo contenedor. hermes-agent lo ve
 * como un servidor MCP stdio normal; el HTTP interno es un detalle de
 * implementación que nunca sale de este proceso.
 *
 * Variables de entorno:
 *   JIRA_FIXTURE_SEED_PATH  — ruta a un JSON con `JiraIssueSeed[]` (obligatoria)
 *   JIRA_FIXTURE_TRACE_PATH — ruta NDJSON donde persistir cada llamada y
 *                             cada snapshot de estado (obligatoria — es la
 *                             única evidencia que sobrevive a que este
 *                             proceso termine, ver jiraStub.ts).
 */
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { JiraStub, type JiraIssueSeed } from './jiraStub.js';
import { createJiraFixtureMcpServer } from './jiraMcpServer.js';

async function main(): Promise<void> {
  const seedPath = process.env['JIRA_FIXTURE_SEED_PATH'];
  const tracePath = process.env['JIRA_FIXTURE_TRACE_PATH'];
  if (!seedPath || !tracePath) {
    throw new Error('jiraMcpServer.bin: faltan JIRA_FIXTURE_SEED_PATH y/o JIRA_FIXTURE_TRACE_PATH');
  }

  const seeds = JSON.parse(readFileSync(seedPath, 'utf-8')) as JiraIssueSeed[];
  const stub = new JiraStub(seeds, { tracePath });
  const { url } = await stub.listen();

  const server = createJiraFixtureMcpServer(url);
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  // stderr, nunca stdout: stdout es el canal del protocolo MCP.
  console.error('jiraMcpServer.bin: fallo fatal', err);
  process.exit(1);
});
