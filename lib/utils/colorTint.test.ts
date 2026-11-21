import { describe, it, expect } from 'vitest';
import { toTint } from './colorTint';

describe('toTint', () => {
  it('mixes the color with transparent at the given percent', () => {
    expect(toTint('var(--color-primary)', 8)).toBe('color-mix(in srgb, var(--color-primary) 8%, transparent)');
  });
});
