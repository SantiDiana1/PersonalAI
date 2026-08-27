/**
 * Catálogo DECLARADO de eslabones a los que `/modelo` puede cambiar — nunca
 * el catálogo completo de hermes-agent (US-15.2). Mismo patrón que
 * `providers.ts`: una lista que el Operador declara al desplegar, no la
 * cadena viva de `fallback_providers` en `config.yaml` (que este bot no lee
 * directamente, por la misma razón de SEC-1.5 que ya aplica a `/proveedores`).
 *
 * Un alias corto porque `openrouter` por sí solo es ambiguo: la cadena real
 * tiene DOS modelos distintos de OpenRouter (Fase 13, US-13.3). El alias es
 * lo que el Operador escribe por Telegram; provider/model es lo que se manda
 * a `hermes config set`.
 */

export interface ModelChoice {
  alias: string;
  provider: string;
  model: string;
}

export class ModelChoicesConfigError extends Error {}

/** Parsea `alias|provider|model,alias|provider|model`. Mismos separadores que parseProbes. */
export function parseModelChoices(raw: string): ModelChoice[] {
  const choices: ModelChoice[] = [];
  for (const entry of raw.split(',').map((e) => e.trim())) {
    if (entry.length === 0) continue;
    const parts = entry.split('|').map((p) => p.trim());
    if (parts.length !== 3) {
      throw new ModelChoicesConfigError(
        `Eslabón mal formado: "${entry}". Formato esperado: alias|provider|model`,
      );
    }
    const [alias, provider, model] = parts as [string, string, string];
    if (alias.length === 0 || provider.length === 0 || model.length === 0) {
      throw new ModelChoicesConfigError(`Eslabón con algún campo vacío: "${entry}"`);
    }
    choices.push({ alias, provider, model });
  }
  const aliases = choices.map((c) => c.alias);
  const dup = aliases.find((a, i) => aliases.indexOf(a) !== i);
  if (dup !== undefined) {
    throw new ModelChoicesConfigError(`Alias duplicado en CONTROL_BOT_MODEL_CHOICES: "${dup}"`);
  }
  return choices;
}

export function findModelChoice(choices: ModelChoice[], alias: string): ModelChoice | undefined {
  const normalized = alias.trim().toLowerCase();
  return choices.find((c) => c.alias.toLowerCase() === normalized);
}
