import { logger } from './logger.js';

/**
 * Límite de tareas concurrentes/por hora — docs/hermes/spec.md §6:
 * "hermes-agent y claude-code-runner-mcp comparten la misma cuota" de la
 * ventana de 5h/semanal de la suscripción Pro compartida, así que un pico de
 * tareas de código no debe poder agotarla en solitario.
 */
export interface RateLimiterOptions {
  maxConcurrent: number;
  maxPerHour: number;
}

export class RateLimiter {
  private running = 0;
  private readonly startTimestamps: number[] = [];

  constructor(private readonly options: RateLimiterOptions) {}

  /** Reserva un slot si hay hueco; devuelve `false` si se supera el límite configurado (concurrencia o ventana de 1h). */
  tryAcquire(): boolean {
    this.prune();
    if (this.running >= this.options.maxConcurrent) {
      logger.warn(
        { running: this.running, max: this.options.maxConcurrent },
        'límite de tareas concurrentes alcanzado',
      );
      return false;
    }
    if (this.startTimestamps.length >= this.options.maxPerHour) {
      logger.warn(
        { count: this.startTimestamps.length, max: this.options.maxPerHour },
        'límite de tareas/hora alcanzado',
      );
      return false;
    }
    this.running += 1;
    this.startTimestamps.push(Date.now());
    return true;
  }

  release(): void {
    this.running = Math.max(0, this.running - 1);
  }

  private prune(): void {
    const cutoff = Date.now() - 60 * 60 * 1000;
    while (this.startTimestamps.length > 0 && (this.startTimestamps[0] ?? 0) <= cutoff) {
      this.startTimestamps.shift();
    }
  }
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Instancia compartida del proceso — un único claude-code-runner-mcp por sesión Pro compartida. */
export const defaultRateLimiter = new RateLimiter({
  maxConcurrent: readIntEnv('CLAUDE_CODE_RUNNER_MAX_CONCURRENT', 2),
  maxPerHour: readIntEnv('CLAUDE_CODE_RUNNER_MAX_PER_HOUR', 10),
});
