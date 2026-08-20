/**
 * apps/brain — servicio de memoria (Personal Brain).
 *
 * Scaffolding de Fase 0 (US-0.1). La lógica real de ingestion/consolidation/
 * retrieval/api llega en fases posteriores (ver docs/roadmap.md Fase 1+ y
 * docs/personal-brain/spec.md).
 */
import { greet, packageInfo } from '@personalai/shared';

export function ping(): string {
  return `${packageInfo.name} says: ${greet('brain')}`;
}
