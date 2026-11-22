import { describe, expect, it } from 'vitest';
import { isEntryPoint } from './entryPoint';

describe('isEntryPoint', () => {
  it('Test_isEntryPoint_ImportedModule', () => {
    expect(isEntryPoint(import.meta.url)).toBe(false);
  });
});
