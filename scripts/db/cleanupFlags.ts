export interface CleanupFlags {
  isProd: boolean;
  shouldApply: boolean;
}

const KNOWN_FLAGS = ['--prod', '--apply'];

// A misspelled --prod must not fall back to the local database silently.
export function parseCleanupFlags(args: readonly string[]): CleanupFlags {
  const unknownFlags = args.filter((arg) => !KNOWN_FLAGS.includes(arg));
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown arguments: ${unknownFlags.join(' ')}. Only --prod and --apply are accepted.`);
  }
  return { isProd: args.includes('--prod'), shouldApply: args.includes('--apply') };
}
