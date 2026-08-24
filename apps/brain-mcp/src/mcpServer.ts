import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrainClient } from './brainClient.js';
import { logger } from './logger.js';

/**
 * Las tres tools MCP que este servidor expone — wrappers finos sobre la API
 * de Brain (docs/personal-brain/spec.md §5.2). Superficie deliberadamente
 * mínima, igual que claude-code-runner-mcp: nada de una tool genérica
 * "haz una petición HTTP a Brain".
 */
export function createMcpServer(client: BrainClient): McpServer {
  const server = new McpServer({ name: 'brain-mcp', version: '0.1.0' });

  server.registerTool(
    'brain_query',
    {
      title: 'brain_query',
      description:
        'Consulta a Brain por similitud semántica y devuelve los fragmentos de texto más ' +
        'relevantes (notas, PRs previos, feedback de tareas anteriores). No consolidado, ' +
        'solo similarity search — ver docs/personal-brain/spec.md §4.3.',
      inputSchema: {
        question: z.string().describe('Pregunta en lenguaje natural sobre la que buscar contexto'),
        k: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ question, k }) => {
      const fragments = await client.query(question, k);
      logger.info({ question, count: fragments.length }, 'brain_query resuelta');
      return { content: [{ type: 'text' as const, text: JSON.stringify({ fragments }) }] };
    },
  );

  server.registerTool(
    'brain_ingest',
    {
      title: 'brain_ingest',
      description:
        'Ingesta manual de un documento de texto en Brain como RawEvent — ver ' +
        'docs/personal-brain/spec.md §4.1.',
      inputSchema: {
        source: z.enum(['notes', 'github', 'notion', 'jira', 'hermes_feedback']),
        sourceAuthority: z.enum(['canonical', 'supporting']),
        text: z.string().min(1),
        externalRef: z.string().optional(),
      },
    },
    async (input) => {
      const event = await client.ingest({
        source: input.source,
        sourceAuthority: input.sourceAuthority,
        text: input.text,
        ...(input.externalRef !== undefined ? { externalRef: input.externalRef } : {}),
      });
      logger.info({ id: event.id, source: input.source }, 'brain_ingest resuelta');
      return { content: [{ type: 'text' as const, text: JSON.stringify(event) }] };
    },
  );

  server.registerTool(
    'brain_record_observation',
    {
      title: 'brain_record_observation',
      description:
        'Registra el resultado de una acción de un agente (p. ej. tras run_coding_task) como ' +
        "feedback en Brain — se persiste como RawEvent de tipo 'hermes_feedback', siempre " +
        "sourceAuthority 'canonical'. Es lo que cierra el bucle de aprendizaje " +
        '(docs/personal-brain/spec.md §5.1).',
      inputSchema: {
        text: z.string().min(1).describe('Resultado de la acción, en lenguaje natural'),
        externalRef: z.string().optional().describe('p. ej. URL del PR'),
      },
    },
    async ({ text, externalRef }) => {
      const event = await client.recordObservation(text, externalRef);
      logger.info({ id: event.id }, 'brain_record_observation resuelta');
      return { content: [{ type: 'text' as const, text: JSON.stringify(event) }] };
    },
  );

  return server;
}
