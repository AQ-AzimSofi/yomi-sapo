/**
 * Values kept in localStorage under a fixed key. A preference names its key, its
 * default and its stored format, and a stored string that does not parse falls back
 * to the default, so a corrupted or outdated entry never reaches the UI.
 */
export interface Preference<T> {
  key: string;
  defaultValue: T;
  /** The value a stored string holds, or undefined when it holds none. */
  parse: (stored: string) => T | undefined;
  serialize: (value: T) => string;
}

export function preferenceValue<T>(preference: Preference<T>, stored: string | null): T {
  if (stored === null) return preference.defaultValue;
  return preference.parse(stored) ?? preference.defaultValue;
}

const listeners = new Set<() => void>();

export function writePreference<T>(storage: Pick<Storage, 'setItem'>, preference: Preference<T>, value: T): void {
  storage.setItem(preference.key, preference.serialize(value));
  listeners.forEach((listener) => listener());
}

/** Calls onChange after every preference write in this tab and, through the storage event, in other tabs. */
export function subscribeToPreferences(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** A preference stored as 'true' or 'false', the format every reader switch has used. */
export function switchPreference<T>({ key, on, off, defaultValue }: {
  key: string;
  on: T;
  off: T;
  defaultValue: T;
}): Preference<T> {
  const valueByStored = new Map([['true', on], ['false', off]]);
  return {
    key,
    defaultValue,
    parse: (stored) => valueByStored.get(stored),
    serialize: (value) => String(value === on),
  };
}

/** A number stored as its decimal string; anything outside [min, max] counts as unset. */
export function numberPreference({ key, min, max, defaultValue }: {
  key: string;
  min: number;
  max: number;
  defaultValue: number;
}): Preference<number> {
  return {
    key,
    defaultValue,
    parse: (stored) => {
      const value = Number(stored);
      const isInRange = value >= min && value <= max;
      return stored.trim() !== '' && isInRange ? value : undefined;
    },
    serialize: String,
  };
}

/** One of a fixed set of strings, stored as itself. */
export function choicePreference<T extends string>({ key, choices, defaultValue }: {
  key: string;
  choices: readonly T[];
  defaultValue: T;
}): Preference<T> {
  return {
    key,
    defaultValue,
    parse: (stored) => choices.find((choice) => choice === stored),
    serialize: (value) => value,
  };
}
