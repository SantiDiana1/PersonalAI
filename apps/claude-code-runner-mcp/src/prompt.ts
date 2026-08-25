import type { RunClaudeCommandInput, RunCodingTaskInput } from './types.js';

/**
 * Genera el contenido de `prompt.md` que se monta en el contenedor efímero
 * y se pasa a `claude -p`. Ver docs/hermes/spec.md §3.2 paso 3.
 */
export function buildPrompt(input: RunCodingTaskInput): string {
  const sections = [`# Tarea: ${input.taskTitle}`, '', input.taskDescription.trim()];

  if (input.brainContext && input.brainContext.trim().length > 0) {
    sections.push('', '## Contexto recuperado de Brain', '', input.brainContext.trim());
  }

  sections.push(
    '',
    '## Instrucciones',
    '',
    '- Sigue el estilo y las convenciones ya presentes en este repositorio.',
    '- Trabaja en la rama que ya está activa. **No crees ramas nuevas ni cambies de rama**: ' +
      'la rama de la tarea ya está creada y es la que se recogerá al terminar.',
    '- Haz commits atómicos y descriptivos **en esa rama**.',
    '- **No hagas `git push` ni abras Pull Requests.** De empujar la rama se encarga el ' +
      'proceso que te ha lanzado, y de abrir el PR se encarga el agente que lo orquesta. ' +
      'Tu trabajo termina en el commit local.',
    '- Si la tarea es ambigua o falta información imprescindible para completarla con confianza, ' +
      'no improvises: escribe en `result.json` `"status": "needs_human_input"` explicando qué falta.',
    '- Al terminar, escribe el resultado en `/workspace/result.json` con el formato ' +
      '`{ "status": "success" | "failed" | "needs_human_input", "summary": string, "commitShas": string[] }`.',
  );

  return sections.join('\n') + '\n';
}

/**
 * Genera el contenido de `command-prompt.md` para `run_claude_command`
 * (Fase 8, US-8.2) — ver docs/hermes/spec.md §3.7 y la nota de diseño en
 * types.ts sobre por qué NO se le pide publicar un Artifact: la tool no
 * está disponible en modo headless, así que pedírselo solo le hace perder
 * turnos intentándolo. En su lugar escribe el resultado autocontenido a un
 * fichero fijo que el runner lee después de que el contenedor termine.
 */
export function buildCommandPrompt(input: RunClaudeCommandInput): string {
  const sections = [`# Comando: ${input.slashCommand}`, '', input.prompt.trim()];

  if (input.brainContext && input.brainContext.trim().length > 0) {
    sections.push('', '## Contexto recuperado de Brain', '', input.brainContext.trim());
  }

  sections.push(
    '',
    '## Instrucciones',
    '',
    `- Ejecuta el skill correspondiente a ${input.slashCommand} para generar el resultado pedido.`,
    '- **No tienes disponible la tool `Artifact` en este entorno (modo headless) — no intentes ' +
      'publicar nada a claude.ai, la llamada fallará.** En su lugar, escribe la página HTML ' +
      'autocontenida final (todo el CSS/JS inline, sin dependencias externas salvo Google Fonts ' +
      'si hace falta) en `/workspace/artifact-output.html`.',
    '- Si la tarea es ambigua sobre qué generar, o no puedes producir un resultado razonable sin ' +
      'más información, no improvises: escribe en `command-result.json` ' +
      '`"status": "needs_human_input"` explicando qué falta.',
    '- Al terminar, escribe el resultado en `/workspace/command-result.json` con el formato ' +
      '`{ "status": "success" | "failed" | "needs_human_input", "summary": string }`.',
  );

  return sections.join('\n') + '\n';
}
