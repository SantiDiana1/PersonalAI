import { describe, expect, it } from 'vitest';
import type { Metrics } from '@personalai/shared';
import { formatMetrics } from './format.js';

const EMPTY: Metrics = {
  generatedAt: '2026-08-26T10:00:00.000Z',
  tasks: {
    byTool: [
      {
        tool: 'run_coding_task',
        total: 0,
        running: 0,
        byStatus: { success: 0, failed: 0, needs_human_input: 0, timed_out: 0 },
        successRate: null,
      },
    ],
    startedLast5h: 2,
    startedLast7d: 2,
    startedLast30d: 2,
  },
  brain: null,
};

describe('formatMetrics', () => {
  it('avisa de que la ventana de 5 h no es consumo real de cuota', () => {
    // El aviso no es decorativo: sin él, "3 tareas en las últimas 5 h" se lee
    // como telemetría de cuota, que es justo lo que Anthropic no expone.
    expect(formatMetrics(EMPTY)).toContain('NO consumo real de cuota');
  });

  it('dice "sin datos" en vez de 0 % cuando nada ha terminado todavía', () => {
    expect(formatMetrics(EMPTY)).toContain('sin datos');
    expect(formatMetrics(EMPTY)).not.toContain('0.0 %');
  });

  it('informa de que Brain no está en vez de omitir la sección', () => {
    expect(formatMetrics(EMPTY)).toContain('esquema no encontrado');
  });
});
