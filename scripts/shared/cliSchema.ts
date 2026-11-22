/**
 * One schema per command-line script: each flag's spec holds its default, so the parser and the
 * --help text read the same value and cannot drift apart.
 */

export interface FlagSpec<Value> {
  /** The flag without its leading dashes, such as chunk-size. */
  name: string;
  /** Shown as <valueName> in the help. A flag without one is a switch, true when present. */
  valueName?: string;
  description: string;
  defaultValue: Value;
  /** The help's default for a value worked out at run time, such as one read from the environment. */
  defaultLabel?: string;
  isRequired?: boolean;
  choices?: readonly string[];
  /** Throws when the value is not one the flag accepts. */
  parseValue: (rawValue: string) => Value;
}

export type CliSchema = Record<string, FlagSpec<unknown>>;

export type ParsedFlags<Schema extends CliSchema> = {
  [Key in keyof Schema]: Schema[Key] extends FlagSpec<infer Value> ? Value : never;
};

export interface CommandLine<Schema extends CliSchema> {
  flags: ParsedFlags<Schema>;
  positionals: string[];
}

export interface CliHelp {
  summary: string;
  usage: readonly string[];
  examples?: readonly string[];
}

interface FlagText {
  name: string;
  description: string;
}

interface ValueFlagText extends FlagText {
  valueName: string;
  defaultLabel?: string;
}

interface NumberLimits {
  isInteger?: boolean;
  min?: number;
  max?: number;
}

interface NamedFlag {
  key: string;
  spec: FlagSpec<unknown>;
}

interface ArgsRead {
  values: ReadonlyMap<string, unknown>;
  positionals: string[];
}

const HELP_FLAGS = ['--help', '-h'];

export function switchFlag(text: FlagText): FlagSpec<boolean> {
  return { ...text, defaultValue: false, parseValue: () => true };
}

export function textFlag(spec: ValueFlagText & { defaultValue: string }): FlagSpec<string>;
export function textFlag(spec: ValueFlagText & { isRequired: true }): FlagSpec<string>;
export function textFlag(spec: ValueFlagText): FlagSpec<string | undefined>;
export function textFlag(spec: ValueFlagText & { defaultValue?: string; isRequired?: boolean }): FlagSpec<string | undefined> {
  return { defaultValue: undefined, ...spec, parseValue: (rawValue) => rawValue };
}

function describeNumberLimits({ isInteger, min, max }: NumberLimits): string {
  const kind = isInteger ? 'a whole number' : 'a number';
  if (min !== undefined && max !== undefined) return `${kind} from ${min} to ${max}`;
  if (min !== undefined) return `${kind} of at least ${min}`;
  if (max !== undefined) return `${kind} of at most ${max}`;
  return kind;
}

function parseNumber(rawValue: string, flagName: string, limits: NumberLimits): number {
  const value = Number(rawValue);
  const isNumber = rawValue.trim() !== '' && Number.isFinite(value);
  const isWithinLimits = value >= (limits.min ?? -Infinity) && value <= (limits.max ?? Infinity);
  const isRightKind = !limits.isInteger || Number.isInteger(value);
  if (isNumber && isWithinLimits && isRightKind) return value;
  throw new Error(`--${flagName} must be ${describeNumberLimits(limits)}, got "${rawValue}".`);
}

export function numberFlag(spec: ValueFlagText & NumberLimits & { defaultValue: number }): FlagSpec<number>;
export function numberFlag(spec: ValueFlagText & NumberLimits): FlagSpec<number | undefined>;
export function numberFlag(spec: ValueFlagText & NumberLimits & { defaultValue?: number }): FlagSpec<number | undefined> {
  const { isInteger, min, max, ...text } = spec;
  return { defaultValue: undefined, ...text, parseValue: (rawValue) => parseNumber(rawValue, spec.name, { isInteger, min, max }) };
}

export function choiceFlag<Choice extends string>(
  spec: ValueFlagText & { choices: readonly Choice[]; defaultValue: Choice },
): FlagSpec<Choice> {
  const parseValue = (rawValue: string): Choice => {
    const choice = spec.choices.find((candidate) => candidate === rawValue);
    if (choice !== undefined) return choice;
    throw new Error(`--${spec.name} must be one of ${spec.choices.join(', ')}, got "${rawValue}".`);
  };
  return { ...spec, parseValue };
}

export function isHelpRequested(args: readonly string[]): boolean {
  return args.some((arg) => HELP_FLAGS.includes(arg));
}

function splitInlineValue(flagArg: string): { flagName: string; inlineValue?: string } {
  const equalsIndex = flagArg.indexOf('=');
  if (equalsIndex === -1) return { flagName: flagArg };
  return { flagName: flagArg.slice(0, equalsIndex), inlineValue: flagArg.slice(equalsIndex + 1) };
}

function withValue(read: ArgsRead, key: string, value: unknown): ArgsRead {
  return { ...read, values: new Map([...read.values, [key, value]]) };
}

// Taking the next flag as a value would turn a missing value into a plausible wrong one,
// such as --model --reset giving the model "--reset".
function readFlagValue(flagName: string, inlineValue: string | undefined, nextArg: string | undefined): string {
  if (inlineValue !== undefined) return inlineValue;
  if (nextArg === undefined) throw new Error(`--${flagName} needs a value.`);
  if (nextArg.startsWith('--')) throw new Error(`--${flagName} needs a value, found "${nextArg}".`);
  return nextArg;
}

// Unknown flags are ignored, as the scripts always have, so older commands keep running; the warning catches typos.
function readArgs(args: readonly string[], flagsByName: ReadonlyMap<string, NamedFlag>, read: ArgsRead): ArgsRead {
  const [arg, ...rest] = args;
  if (arg === undefined) return read;
  if (!arg.startsWith('--')) return readArgs(rest, flagsByName, { ...read, positionals: [...read.positionals, arg] });

  const { flagName, inlineValue } = splitInlineValue(arg.slice(2));
  const flag = flagsByName.get(flagName);
  if (!flag) {
    console.warn(`Unknown option ${arg} is ignored (see --help).`);
    return readArgs(rest, flagsByName, read);
  }
  const isSwitch = !flag.spec.valueName;
  if (isSwitch && inlineValue !== undefined) throw new Error(`--${flagName} takes no value.`);
  if (isSwitch) return readArgs(rest, flagsByName, withValue(read, flag.key, true));
  const rawValue = readFlagValue(flagName, inlineValue, rest[0]);
  const remainingArgs = inlineValue === undefined ? rest.slice(1) : rest;
  return readArgs(remainingArgs, flagsByName, withValue(read, flag.key, flag.spec.parseValue(rawValue)));
}

/** Reads every flag the schema lists; flags left out take their default, and the other arguments are positionals. */
export function parseCommandLine<Schema extends CliSchema>(schema: Schema, args: readonly string[]): CommandLine<Schema> {
  const flagsByName = new Map(Object.entries(schema).map(([key, spec]) => [spec.name, { key, spec }]));
  const { values, positionals } = readArgs(args, flagsByName, { values: new Map(), positionals: [] });

  const missingFlags = Object.entries(schema).filter(([key, spec]) => spec.isRequired && !values.has(key));
  if (missingFlags.length > 0) {
    throw new Error(`Missing required option(s): ${missingFlags.map(([, spec]) => `--${spec.name}`).join(', ')} (see --help).`);
  }
  const flagEntries = Object.entries(schema).map(([key, spec]) => [key, values.has(key) ? values.get(key) : spec.defaultValue]);
  return { flags: Object.fromEntries(flagEntries) as ParsedFlags<Schema>, positionals };
}

function formatFlagColumn(spec: FlagSpec<unknown>): string {
  return spec.valueName ? `--${spec.name} <${spec.valueName}>` : `--${spec.name}`;
}

function formatDefault(spec: FlagSpec<unknown>): string | undefined {
  if (spec.isRequired) return 'required';
  if (spec.defaultLabel) return `default: ${spec.defaultLabel}`;
  if (!spec.valueName || spec.defaultValue === undefined) return undefined;
  return `default: ${String(spec.defaultValue)}`;
}

function formatFlagText(spec: FlagSpec<unknown>): string {
  const notes = [spec.choices && `one of ${spec.choices.join(', ')}`, formatDefault(spec)].filter(Boolean);
  return notes.length > 0 ? `${spec.description} (${notes.join('; ')})` : spec.description;
}

export function formatHelp(schema: CliSchema, help: CliHelp): string {
  const rows = [
    ...Object.values(schema).map((spec) => ({ flag: formatFlagColumn(spec), text: formatFlagText(spec) })),
    { flag: HELP_FLAGS.join(', '), text: 'Show this help' },
  ];
  const flagColumnWidth = Math.max(...rows.map((row) => row.flag.length)) + 2;
  const sections = [
    [help.summary],
    ['Usage:', ...help.usage.map((usageLine) => `  ${usageLine}`)],
    ['Options:', ...rows.map((row) => `  ${row.flag.padEnd(flagColumnWidth)}${row.text}`)],
    help.examples ? ['Examples:', ...help.examples.map((example) => `  ${example}`)] : [],
  ];
  return sections.filter((lines) => lines.length > 0).map((lines) => lines.join('\n')).join('\n\n');
}
