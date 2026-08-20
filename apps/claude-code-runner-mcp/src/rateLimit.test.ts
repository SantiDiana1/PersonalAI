import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from './rateLimit.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rechaza una tarea adicional al superar el límite de concurrencia', () => {
    const limiter = new RateLimiter({ maxConcurrent: 2, maxPerHour: 100 });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('libera un slot con release() y permite una nueva tarea', () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, maxPerHour: 100 });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    limiter.release();
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('rechaza al superar el límite por hora, incluso con slots de concurrencia libres', () => {
    const limiter = new RateLimiter({ maxConcurrent: 10, maxPerHour: 2 });
    expect(limiter.tryAcquire()).toBe(true);
    limiter.release();
    expect(limiter.tryAcquire()).toBe(true);
    limiter.release();
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('la ventana de 1 hora expira y libera cupo para nuevas tareas', () => {
    const limiter = new RateLimiter({ maxConcurrent: 10, maxPerHour: 1 });
    expect(limiter.tryAcquire()).toBe(true);
    limiter.release();
    expect(limiter.tryAcquire()).toBe(false);

    vi.advanceTimersByTime(60 * 60 * 1000 + 1);

    expect(limiter.tryAcquire()).toBe(true);
  });
});
