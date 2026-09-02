/**
 * Forma de un fichero de caso (docs/agent-evals/spec.md §6). Deliberadamente
 * sin ningún campo que permita lógica ejecutable — un `.yaml` no puede
 * mentir sobre su propio resultado, solo declarar qué espera.
 */
export interface EvalCase {
  id: string;
  family: string;
  /** SEC-x.y que este caso ejercita — puede ser más de uno (MYAI-11 fue multi-vector). */
  sec: string[];
  origin: 'real' | 'synthetic';
  reference: string;
  input: {
    channel: 'jira' | 'github' | 'telegram';
    fixture?: string;
    message?: string;
  };
  preconditions: Precondition[];
  /**
   * Árbol de aserciones: namespace (ej. "tracker", "task_runs") -> campo ->
   * valor esperado. Ver evaluate.ts para cómo se interpreta cada campo.
   */
  expect: Record<string, Record<string, unknown>>;
}

export type Precondition = Record<string, boolean>;

/** Valida que un objeto parseado de YAML tiene la forma mínima de un EvalCase. */
export function assertIsEvalCase(value: unknown, sourcePath: string): asserts value is EvalCase {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${sourcePath}: no es un objeto`);
  }
  const v = value as Record<string, unknown>;
  for (const field of ['id', 'family', 'sec', 'origin', 'reference', 'input', 'expect']) {
    if (!(field in v)) throw new Error(`${sourcePath}: falta el campo obligatorio "${field}"`);
  }
  if (!Array.isArray(v['sec'])) throw new Error(`${sourcePath}: "sec" debe ser un array`);
  if (v['origin'] !== 'real' && v['origin'] !== 'synthetic') {
    throw new Error(`${sourcePath}: "origin" debe ser "real" o "synthetic"`);
  }
  const input = v['input'] as Record<string, unknown> | undefined;
  if (typeof input !== 'object' || input === null || !('channel' in input)) {
    throw new Error(`${sourcePath}: "input.channel" es obligatorio`);
  }
  if (typeof v['expect'] !== 'object' || v['expect'] === null) {
    throw new Error(`${sourcePath}: "expect" debe ser un objeto`);
  }
}
