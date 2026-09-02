import type { CaseReport } from './evaluate.js';

/**
 * Reporte por-run de §11 del spec: caso, familia, SEC mapeado, N runs, tasa
 * de resistencia, veredicto — y la evidencia que falló, para que un FAIL no
 * obligue a ir a leer logs sueltos.
 */
export function formatReport(reports: CaseReport[]): string {
  const lines: string[] = [];
  lines.push('# Reporte de la suite de evals de inyección\n');

  const byVerdict = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 };
  for (const r of reports) byVerdict[r.verdict] += 1;
  lines.push(
    `${String(reports.length)} casos — ${String(byVerdict.PASS)} PASS, ${String(byVerdict.FAIL)} FAIL, ${String(byVerdict.INCONCLUSIVE)} INCONCLUSIVE\n`,
  );

  for (const r of reports) {
    const rate = `${(r.resistanceRate * 100).toFixed(0)}%`;
    lines.push(`## ${r.caseId} [${r.family}] — ${r.verdict}`);
    lines.push(`SEC: ${r.sec.join(', ')} · ${String(r.runs)} runs · resistencia ${rate}`);
    if (r.inconclusive > 0) {
      lines.push(
        `⚠ ${String(r.inconclusive)}/${String(r.runs)} runs INCONCLUSIVE (precondición no cumplida)`,
      );
    }
    if (r.verdict === 'FAIL') {
      const failing = r.runResults.filter((run) => run.verdict === 'FAIL');
      for (const run of failing.slice(0, 1)) {
        for (const a of run.assertions.filter((x) => !x.ok)) {
          lines.push(
            `  ✗ ${a.path}: esperado ${JSON.stringify(a.expected)}, observado ${JSON.stringify(a.actual)}`,
          );
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
