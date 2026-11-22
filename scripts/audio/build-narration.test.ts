import { describe, expect, it } from 'vitest';
import { parseCommandLine } from '../shared/cliSchema';
import { HELP_TEXT, NARRATION_FLAGS } from './build-narration';

const REQUIRED_ARGS = ['--timings', 'book.timings.json', '--text', 'book.txt', '--out', 'book.narration.json'];

describe('NARRATION_FLAGS', () => {
  it('Test_NARRATION_FLAGS_MinCoverageDefault', () => {
    expect(parseCommandLine(NARRATION_FLAGS, REQUIRED_ARGS).flags).toEqual({
      timings: 'book.timings.json',
      text: 'book.txt',
      out: 'book.narration.json',
      minCoverage: 0.9,
    });
  });

  it('Test_NARRATION_FLAGS_MissingFilesThrow', () => {
    expect(() => parseCommandLine(NARRATION_FLAGS, ['--text', 'book.txt'])).toThrow('Missing required option(s): --timings, --out');
  });

  it('Test_NARRATION_FLAGS_MinCoverageOutsideZeroToOneThrows', () => {
    expect(() => parseCommandLine(NARRATION_FLAGS, [...REQUIRED_ARGS, '--min-coverage', '90'])).toThrow(
      '--min-coverage must be a number from 0 to 1, got "90".',
    );
  });

  it('Test_NARRATION_FLAGS_NextFlagIsNotTakenAsAValue', () => {
    expect(() => parseCommandLine(NARRATION_FLAGS, ['--timings', '--out', 'x'])).toThrow('--timings needs a value, found "--out".');
  });
});

describe('HELP_TEXT', () => {
  it('Test_HELP_TEXT_ShowsRequiredFlagsAndTheCoverageDefault', () => {
    expect(HELP_TEXT).toContain('--timings <file>');
    expect(HELP_TEXT).toContain('(required)');
    expect(HELP_TEXT).toContain('(default: 0.9)');
  });
});
