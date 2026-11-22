import { afterEach, describe, expect, it, vi } from 'vitest';
import { choiceFlag, formatHelp, isHelpRequested, numberFlag, parseCommandLine, switchFlag, textFlag } from './cliSchema';

const SCHEMA = {
  outputDir: textFlag({ name: 'output-dir', valueName: 'dir', defaultValue: 'books', description: 'Output folder' }),
  databaseUrl: textFlag({ name: 'database-url', valueName: 'url', defaultLabel: 'DATABASE_URL', description: 'Database' }),
  chunkSize: numberFlag({ name: 'chunk-size', valueName: 'n', defaultValue: 50, isInteger: true, min: 1, description: 'Chunk size' }),
  coverage: numberFlag({ name: 'coverage', valueName: '0-1', defaultValue: 0.5, min: 0, max: 1, description: 'Coverage' }),
  filter: choiceFlag({ name: 'filter', valueName: 'level', choices: ['all', 'n3'], defaultValue: 'all', description: 'Kanji filter' }),
  reset: switchFlag({ name: 'reset', description: 'Start over' }),
};

const REQUIRED_SCHEMA = {
  timings: textFlag({ name: 'timings', valueName: 'file', isRequired: true, description: 'Timings' }),
  text: textFlag({ name: 'text', valueName: 'file', isRequired: true, description: 'Text' }),
};

describe('parseCommandLine', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Test_parseCommandLine_FlagsLeftOutTakeTheirDefaults', () => {
    expect(parseCommandLine(SCHEMA, [])).toEqual({
      flags: { outputDir: 'books', databaseUrl: undefined, chunkSize: 50, coverage: 0.5, filter: 'all', reset: false },
      positionals: [],
    });
  });

  it('Test_parseCommandLine_ReadsEveryKindOfFlag', () => {
    const { flags } = parseCommandLine(SCHEMA, ['--output-dir', 'out', '--database-url', 'pg://x', '--chunk-size', '7', '--coverage', '0.25', '--filter', 'n3', '--reset']);
    expect(flags).toEqual({ outputDir: 'out', databaseUrl: 'pg://x', chunkSize: 7, coverage: 0.25, filter: 'n3', reset: true });
  });

  it('Test_parseCommandLine_ArgumentsThatAreNotFlagsArePositionals', () => {
    expect(parseCommandLine(SCHEMA, ['book.epub', '--reset', 'extra']).positionals).toEqual(['book.epub', 'extra']);
  });

  it('Test_parseCommandLine_ValueAfterEqualsSign', () => {
    expect(parseCommandLine(SCHEMA, ['--chunk-size=9']).flags.chunkSize).toBe(9);
  });

  it('Test_parseCommandLine_UnknownFlagIsIgnoredWithAWarning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parseCommandLine(SCHEMA, ['--colour', '--reset']).flags.reset).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith('Unknown option --colour is ignored (see --help).');
  });

  it('Test_parseCommandLine_MissingValueThrows', () => {
    expect(() => parseCommandLine(SCHEMA, ['--output-dir'])).toThrow('--output-dir needs a value.');
  });

  it('Test_parseCommandLine_NextFlagIsNotTakenAsAValue', () => {
    expect(() => parseCommandLine(SCHEMA, ['--output-dir', '--reset'])).toThrow('--output-dir needs a value, found "--reset".');
  });

  it.each([
    [['--chunk-size', 'abc'], '--chunk-size must be a whole number of at least 1, got "abc".'],
    [['--chunk-size', '2.5'], '--chunk-size must be a whole number of at least 1, got "2.5".'],
    [['--chunk-size', '0'], '--chunk-size must be a whole number of at least 1, got "0".'],
    [['--coverage', '1.5'], '--coverage must be a number from 0 to 1, got "1.5".'],
    [['--filter', 'n5'], '--filter must be one of all, n3, got "n5".'],
    [['--reset=yes'], '--reset takes no value.'],
  ])('Test_parseCommandLine_BadValueThrows %j', (args, message) => {
    expect(() => parseCommandLine(SCHEMA, args)).toThrow(message);
  });

  it('Test_parseCommandLine_MissingRequiredFlagsAreListedTogether', () => {
    expect(() => parseCommandLine(REQUIRED_SCHEMA, [])).toThrow('Missing required option(s): --timings, --text (see --help).');
  });

  it('Test_parseCommandLine_RequiredFlagsGiven', () => {
    expect(parseCommandLine(REQUIRED_SCHEMA, ['--timings', 't.json', '--text', 'b.txt']).flags).toEqual({ timings: 't.json', text: 'b.txt' });
  });
});

describe('isHelpRequested', () => {
  it.each([[['--help'], true], [['book.epub', '-h'], true], [['book.epub'], false]])('Test_isHelpRequested %j', (args, expected) => {
    expect(isHelpRequested(args)).toBe(expected);
  });
});

describe('formatHelp', () => {
  const help = formatHelp(SCHEMA, { summary: 'Makes a book.', usage: ['make <input> [options]'], examples: ['make book.epub --reset'] });

  it('Test_formatHelp_ShowsEachDefaultFromTheSchema', () => {
    expect(help).toContain('--output-dir <dir>    Output folder (default: books)');
    expect(help).toContain('--chunk-size <n>      Chunk size (default: 50)');
    expect(help).toContain('--database-url <url>  Database (default: DATABASE_URL)');
  });

  it('Test_formatHelp_ListsChoicesAndLeavesSwitchesWithoutDefault', () => {
    expect(help).toContain('--filter <level>      Kanji filter (one of all, n3; default: all)');
    expect(help).toContain('  --reset               Start over\n');
  });

  it('Test_formatHelp_Layout', () => {
    expect(help.split('\n\n').map((section) => section.split('\n')[0])).toEqual(['Makes a book.', 'Usage:', 'Options:', 'Examples:']);
    expect(help).toContain('  --help, -h            Show this help');
  });

  it('Test_formatHelp_MarksRequiredFlags', () => {
    expect(formatHelp(REQUIRED_SCHEMA, { summary: 's', usage: ['u'] })).toContain('--timings <file>  Timings (required)');
  });
});
