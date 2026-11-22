export type KanjiFilter = 'all' | 'n3';

export interface PipelineOptions {
  /** The EPUB, or with --skip-extract any path named after the book. */
  inputPath: string;
  outputDir: string;
  chunkSize: number;
  delaySeconds: number;
  model: string;
  skipRephrase: boolean;
  skipExtract: boolean;
  skipImages: boolean;
  filter: KanjiFilter;
  reset: boolean;
  dryRun: boolean;
  /** Where each chunk is synced; unset means the DATABASE_URL the app uses. Only a local database is accepted. */
  databaseUrl?: string;
}

export interface PreparedBook {
  bookName: string;
  /** public/<outputDir>/<bookName>, the folder every step reads and writes. */
  sourceDir: string;
  /** Set when the book was extracted from an EPUB, for the steps that read it again. */
  epubPath?: string;
}

export interface PipelineContext {
  options: PipelineOptions;
  book: PreparedBook;
}

export interface Step {
  name: string;
  shouldRun: (context: PipelineContext) => boolean;
  run: (context: PipelineContext) => Promise<void>;
}

/** Runs the steps in order. A step that throws stops the run, so later steps never see a half-made book. */
export async function runSteps(steps: readonly Step[], context: PipelineContext): Promise<void> {
  for (const [stepIndex, step] of steps.entries()) {
    const label = `Step ${stepIndex + 1}/${steps.length}: ${step.name}`;
    if (!step.shouldRun(context)) {
      console.log(`\n=== Skipping ${label} ===`);
      continue;
    }
    console.log(`\n=== ${label} ===\n`);
    await step.run(context);
  }
}
