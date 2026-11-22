import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSteps, type PipelineContext, type PipelineOptions, type Step } from './runner';

const OPTIONS: PipelineOptions = {
  inputPath: 'book.epub',
  outputDir: 'bookv2-furigana',
  chunkSize: 5000,
  delaySeconds: 0,
  model: 'sonnet',
  skipRephrase: false,
  skipExtract: false,
  skipImages: false,
  filter: 'all',
  reset: false,
  dryRun: false,
  apiUrl: 'http://127.0.0.1:9',
};
const CONTEXT: PipelineContext = { options: OPTIONS, book: { bookName: 'book', sourceDir: 'public/bookv2-furigana/book' } };

function createStep(name: string, ranNames: string[], overrides: Partial<Step> = {}): Step {
  return {
    name,
    shouldRun: () => true,
    run: async () => {
      ranNames.push(name);
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runSteps', () => {
  it('Test_runSteps_RunsStepsInListOrder', async () => {
    const ranNames: string[] = [];
    await runSteps([createStep('a', ranNames), createStep('b', ranNames), createStep('c', ranNames)], CONTEXT);
    expect(ranNames).toEqual(['a', 'b', 'c']);
  });

  it('Test_runSteps_SkipsAStepWhoseShouldRunIsFalse', async () => {
    const ranNames: string[] = [];
    const steps = [createStep('a', ranNames), createStep('b', ranNames, { shouldRun: () => false }), createStep('c', ranNames)];
    await runSteps(steps, CONTEXT);
    expect(ranNames).toEqual(['a', 'c']);
  });

  it('Test_runSteps_ShouldRunAndRunGetTheContext', async () => {
    const shouldRun = vi.fn(() => true);
    const run = vi.fn(async () => undefined);
    await runSteps([{ name: 'a', shouldRun, run }], CONTEXT);
    expect(shouldRun).toHaveBeenCalledWith(CONTEXT);
    expect(run).toHaveBeenCalledWith(CONTEXT);
  });

  it('Test_runSteps_AThrowingStepStopsTheRun', async () => {
    const ranNames: string[] = [];
    const failingStep = createStep('b', ranNames, { run: async () => Promise.reject(new Error('b failed')) });
    await expect(runSteps([createStep('a', ranNames), failingStep, createStep('c', ranNames)], CONTEXT)).rejects.toThrow('b failed');
    expect(ranNames).toEqual(['a']);
  });

  it('Test_runSteps_WaitsForEachStepBeforeTheNext', async () => {
    const ranNames: string[] = [];
    const slowStep = createStep('slow', ranNames, {
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        ranNames.push('slow');
      },
    });
    await runSteps([slowStep, createStep('next', ranNames)], CONTEXT);
    expect(ranNames).toEqual(['slow', 'next']);
  });
});
