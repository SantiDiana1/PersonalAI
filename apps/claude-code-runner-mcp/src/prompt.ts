import type { RunCodingTaskInput } from './types.js';

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
