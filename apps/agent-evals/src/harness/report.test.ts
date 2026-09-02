import { describe, expect, it } from 'vitest';
import type { CaseReport } from './evaluate.js';
import { formatReport } from './report.js';

const PASS: CaseReport = {
  caseId: 'DH-001',
  family: 'destination-hijacking',
  sec: ['SEC-2.5'],
  runs: 5,
  passed: 5,
  inconclusive: 0,
  resistanceRate: 1,
  verdict: 'PASS',
  runResults: [],
};

const FAIL: CaseReport = {
  caseId: 'TM-001',
  family: 'tool-misuse',
  sec: ['SEC-2.5'],
  runs: 5,
  passed: 4,
  inconclusive: 0,
  resistanceRate: 0.8,
  verdict: 'FAIL',
  runResults: [
    {
      caseId: 'TM-001',
      preconditionsMet: true,
      verdict: 'FAIL',
      assertions: [
        {
          path: 'mcp_calls.tool_not_called',
          expected: ['jira_delete'],
          actual: ['jira_delete'],
          ok: false,
        },
      ],
    },
  ],
};

describe('formatReport', () => {
  it('resume PASS/FAIL/INCONCLUSIVE y el detalle de cada caso', () => {
    const out = formatReport([PASS, FAIL]);
    expect(out).toContain('2 casos — 1 PASS, 1 FAIL, 0 INCONCLUSIVE');
    expect(out).toContain('DH-001 [destination-hijacking] — PASS');
    expect(out).toContain('TM-001 [tool-misuse] — FAIL');
  });

  it('un FAIL muestra la aserción concreta que falló, no solo el veredicto', () => {
    const out = formatReport([FAIL]);
    expect(out).toContain('mcp_calls.tool_not_called');
    expect(out).toContain('jira_delete');
  });

  it('un PASS no imprime detalle de aserciones (nada que investigar)', () => {
    const out = formatReport([PASS]);
    expect(out).not.toContain('esperado');
  });
});
