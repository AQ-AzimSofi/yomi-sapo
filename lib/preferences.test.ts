import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  choicePreference,
  numberPreference,
  preferenceValue,
  subscribeToPreferences,
  switchPreference,
  writePreference,
} from './preferences';

const theme = switchPreference({ key: 'theme', on: 'dark', off: 'light', defaultValue: 'light' });
const size = numberPreference({ key: 'size', min: 12, max: 24, defaultValue: 16 });
const mode = choicePreference({ key: 'mode', choices: ['main', 'sub', 'both'], defaultValue: 'main' });

function memoryStorage(): Pick<Storage, 'setItem'> & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, setItem: (key, value) => values.set(key, value) };
}

describe('preferenceValue', () => {
  it('falls back to the default when nothing is stored', () => {
    expect(preferenceValue(size, null)).toBe(16);
  });

  it('falls back to the default when the stored value does not parse', () => {
    expect(preferenceValue(theme, 'sepia')).toBe('light');
  });

  it('keeps a stored value that parses to false', () => {
    const flag = switchPreference({ key: 'flag', on: true, off: false, defaultValue: true });

    expect(preferenceValue(flag, 'false')).toBe(false);
  });
});

describe('switchPreference', () => {
  it.each([['true', 'dark'], ['false', 'light']])('reads a stored %s as %s', (stored, value) => {
    expect(theme.parse(stored)).toBe(value);
  });

  it.each(['TRUE', '', '1', 'dark'])('treats %j as unset', (stored) => {
    expect(theme.parse(stored)).toBeUndefined();
  });

  it.each([['dark', 'true'], ['light', 'false']] as const)('stores %s as %s', (value, stored) => {
    expect(theme.serialize(value)).toBe(stored);
  });
});

describe('numberPreference', () => {
  it('reads a stored number', () => {
    expect(size.parse('18')).toBe(18);
  });

  it.each(['12', '24'])('accepts the bound %s', (stored) => {
    expect(size.parse(stored)).toBe(Number(stored));
  });

  it.each(['abc', 'NaN', '', ' ', '11', '25', 'Infinity', '16px'])('treats %j as unset', (stored) => {
    expect(size.parse(stored)).toBeUndefined();
  });

  it('stores a number as its decimal string', () => {
    expect(size.serialize(1.5)).toBe('1.5');
  });
});

describe('choicePreference', () => {
  it('reads a stored choice', () => {
    expect(mode.parse('sub')).toBe('sub');
  });

  it('treats a string outside the choices as unset', () => {
    expect(mode.parse('loud')).toBeUndefined();
  });
});

describe('writePreference', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores the serialized value under the preference key', () => {
    const storage = memoryStorage();

    writePreference(storage, theme, 'dark');

    expect(storage.values.get('theme')).toBe('true');
  });

  it('tells every subscriber about the write', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToPreferences(onChange);

    writePreference(memoryStorage(), size, 18);
    unsubscribe();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('stops telling a subscriber once it unsubscribes', () => {
    const onChange = vi.fn();
    subscribeToPreferences(onChange)();

    writePreference(memoryStorage(), size, 18);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('tells subscribers about a write from another tab', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToPreferences(onChange);

    window.dispatchEvent(new Event('storage'));
    unsubscribe();

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
