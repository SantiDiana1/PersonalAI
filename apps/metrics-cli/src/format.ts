import type { Metrics, ToolMetrics } from './metrics.js';

function pct(rate: number | null): string {
  return rate === null ? 'sin datos' : `${(rate * 100).toFixed(1)} %`;
}

function toolBlock(m: ToolMetrics): string[] {
  const lines = [
    `  ${m.tool}`,
    `    resueltas (success):  ${m.byStatus.success}`,
    `    fallidas:             ${m.byStatus.failed}`,
    `    requieren atención:   ${m.byStatus.needs_human_input}`,
    `    timeout:              ${m.byStatus.timed_out}`,
  ];
  if (m.running > 0) {
    lines.push(`    en curso:             ${m.running}`);
  }
  lines.push(`    tasa de éxito:        ${pct(m.successRate)}`);
  return lines;
}

export function formatMetrics(metrics: Metrics): string {
  const lines: string[] = [];
  lines.push(`PersonalAI — métricas de uso real (${metrics.generatedAt})`);
  lines.push('');
  lines.push('Tareas delegadas a Claude Code (runner.task_runs)');
  for (const tool of metrics.tasks.byTool) {
    lines.push(...toolBlock(tool));
  }
  lines.push('');
  lines.push('  Tareas iniciadas por ventana');
  lines.push(`    últimas 5 h:          ${metrics.tasks.startedLast5h}`);
  lines.push(`    últimos 7 días:       ${metrics.tasks.startedLast7d}`);
  lines.push(`    últimos 30 días:      ${metrics.tasks.startedLast30d}`);
  // La ventana de 5 h es la de la cuota de Claude Pro, y esta cuenta es lo
  // más cerca que se puede estar de medirla desde aquí: Anthropic no expone
  // API de consumo. Decirlo aquí y no solo en la documentación evita que el
  // número se lea como telemetría real de cuota — ver Fase 12 del roadmap.
  lines.push('    (nº de tareas, NO consumo real de cuota: Anthropic no lo expone por API)');
  lines.push('');

  if (metrics.brain === null) {
    lines.push('Brain (brain.raw_events)');
    lines.push('  esquema no encontrado en esta base de datos — sin datos que mostrar');
  } else {
    lines.push('Brain (brain.raw_events)');
    lines.push(`  eventos ingestados:     ${metrics.brain.totalEvents}`);
    lines.push(`  ingestados últimos 7 d: ${metrics.brain.eventsLast7d}`);
    if (metrics.brain.bySource.length > 0) {
      lines.push('  por fuente:');
      for (const s of metrics.brain.bySource) {
        lines.push(`    ${s.source.padEnd(20)} ${s.count}`);
      }
    }
  }

  return lines.join('\n');
}
