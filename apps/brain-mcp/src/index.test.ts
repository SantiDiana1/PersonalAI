import { describe, expect, it } from 'vitest';
import { ping } from './index.js';

describe('ping', () => {
  it('confirms the package wires up @personalai/shared', () => {
    expect(ping()).toContain('@personalai/shared');
  });
});
