import type { EvalCase } from './case.js';
import { evaluateRun, summarizeCase, type CaseReport, type EvidenceBundle } from './evaluate.js';

/**
 * Implementa el modelo de ejecución de §7 del spec: provision → deliver →
 * wait → collect → evaluate → teardown, repetido N veces (§8, por defecto
 * 5 — el listón de un caso de seguridad es 100%, no una media).
 *
 * `deliver` es deliberadamente inyectado, no algo que este fichero sepa
 * hacer por sí mismo: es el único paso que factura contra un proveedor de
 * modelo de verdad (§10 del spec) y el único que necesita el stack real de
 * hermes-agent arriba. Mantenerlo como un hook mantiene el resto del
 * harness — provisión de fixtures, recolección de evidencia, evaluación —
 * corriendo y testeable sin gastar un céntimo ni tocar Docker.
 *
 * `Ctx` es opaco a este fichero a propósito: quien orquesta un run concreto
 * decide qué necesita (una instancia de `JiraStub`, un `GithubFixture`, el
 * `Pool` de Postgres...) y este orquestador solo conoce el ciclo de vida.
 */
export interface RunCaseHooks<Ctx> {
  /** Arranca fixtures limpios para un run — nunca reutiliza estado del run anterior. */
  provision: () => Promise<Ctx>;
  /** Entrega el input por el canal real (§7 paso 2). Devuelve si el ataque llegó a lanzarse de verdad. */
  deliver: (ctx: Ctx, evalCase: EvalCase) => Promise<{ preconditionsMet: boolean }>;
  /** Recoge evidencia de TODAS las fuentes relevantes, no solo las que el caso comprueba (§7 paso 4). */
  collectEvidence: (ctx: Ctx, evalCase: EvalCase) => Promise<EvidenceBundle>;
  /** Tira abajo el run. Debe fallar alto si deja algo atrás (§7 paso 6) — no tragarse el error. */
  teardown: (ctx: Ctx) => Promise<void>;
}

export interface RunCaseOptions {
  /** Número de repeticiones. Por defecto 5, como fija §8 del spec. */
  runs?: number;
  /** Se invoca tras cada run individual — para progreso en un CLI, opcional. */
  onRunComplete?: (index: number, total: number) => void;
}

export async function runCase<Ctx>(
  evalCase: EvalCase,
  hooks: RunCaseHooks<Ctx>,
  options: RunCaseOptions = {},
): Promise<CaseReport> {
  const runs = options.runs ?? 5;
  const runResults = [];

  for (let i = 0; i < runs; i++) {
    const ctx = await hooks.provision();
    try {
      const { preconditionsMet } = await hooks.deliver(ctx, evalCase);
      const evidence = preconditionsMet
        ? await hooks.collectEvidence(ctx, evalCase)
        : ({} as EvidenceBundle);
      runResults.push(evaluateRun(evalCase, evidence, preconditionsMet));
    } finally {
      // Teardown corre siempre, incluso si deliver/collectEvidence lanzaron
      // — un run fallido no debe dejar un stub o un repo huérfano detrás.
      await hooks.teardown(ctx);
    }
    options.onRunComplete?.(i + 1, runs);
  }

  return summarizeCase(evalCase, runResults);
}
