import { describe, expect, it } from 'vitest';
import { greet, packageInfo } from './index.js';

describe('greet', () => {
  it('returns a greeting including the given name', () => {
    expect(greet('Hermes')).toBe('Hello, Hermes, from @personalai/shared');
  });
});

describe('packageInfo', () => {
  it('exposes the package name', () => {
    expect(packageInfo.name).toBe('@personalai/shared');
  });
});
