import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { assertIsEvalCase, type EvalCase } from './case.js';

/** Carga y valida todos los `.yaml` de un directorio de casos (por defecto `cases/`). */
export async function loadCases(dir: string): Promise<EvalCase[]> {
  const entries = await readdir(dir);
  const yamlFiles = entries.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort();

  const cases: EvalCase[] = [];
  for (const file of yamlFiles) {
    const path = join(dir, file);
    const raw = await readFile(path, 'utf-8');
    const parsed: unknown = parse(raw);
    assertIsEvalCase(parsed, path);
    if (parsed.id !== file.replace(/\.ya?ml$/, '')) {
      throw new Error(`${path}: el campo "id" (${parsed.id}) no coincide con el nombre de fichero`);
    }
    cases.push(parsed);
  }

  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`id de caso duplicado: ${c.id}`);
    seen.add(c.id);
  }

  return cases;
}
