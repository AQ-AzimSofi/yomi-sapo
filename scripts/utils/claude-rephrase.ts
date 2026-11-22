import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from '../shared/repoPaths';

const PROMPT_PATH = path.join(REPO_ROOT, 'scripts', 'prompts', 'claude-rephrase.md');
const MAX_ATTEMPTS = 3;
const CLAUDE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_ERROR_PREVIEW_CHARS = 500;
const NUMBERED_LINE_PATTERN = /^[[［](\d+)[\]］]\s*(.+)$/;

export type RewritesByNumber = ReadonlyMap<number, readonly string[]>;

export interface ClaudeRephrase {
  text: string;
  skippedParagraphs: string[];
  attempts: number;
}

interface ClaudeReply {
  result: string;
  is_error: boolean;
}

interface RewriteRound {
  paragraphs: readonly string[];
  model: string;
  /** Ctrl+C: kills the claude -p call in flight and starts no other. */
  signal?: AbortSignal;
  rewrites: RewritesByNumber;
  attempt: number;
  lastReply: string;
}

export function isClaudeModel(model: string): boolean {
  return !model.startsWith('gemini');
}

export function splitParagraphs(chunk: string): string[] {
  return chunk.split('\n').map((line) => line.trim()).filter(Boolean);
}

export function numberParagraphs(paragraphs: readonly string[], numbers: readonly number[]): string {
  return numbers.map((number) => `[${number}] ${paragraphs[number - 1]}`).join('\n');
}

// Lines without a requested number, such as a preamble, are dropped.
export function parseRewrites(response: string, requestedNumbers: ReadonlySet<number>): RewritesByNumber {
  const entries = response
    .split(/\r?\n/)
    .map((line) => NUMBERED_LINE_PATTERN.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ number: Number(match[1]), text: match[2].trim() }))
    .filter((entry) => requestedNumbers.has(entry.number));
  const numbers = [...new Set(entries.map((entry) => entry.number))];
  return new Map(numbers.map((number) => [
    number,
    entries.filter((entry) => entry.number === number).map((entry) => entry.text),
  ]));
}

// The original line comes from the book rather than the reply, so the model cannot garble it.
// A paragraph Claude never rewrote shows its original as the rewrite.
export function formatPairs(paragraphs: readonly string[], rewrites: RewritesByNumber): string {
  return paragraphs
    .map((paragraph, index) => {
      const rewriteLines = rewrites.get(index + 1) ?? [paragraph];
      return [`< ${paragraph}`, ...rewriteLines.map((line) => `>> ${line}`)].join('\n');
    })
    .join('\n\n');
}

function parseReply(stdout: string): ClaudeReply | undefined {
  try {
    const reply = JSON.parse(stdout) as Partial<ClaudeReply>;
    return typeof reply.result === 'string' ? (reply as ClaudeReply) : undefined;
  } catch {
    return undefined;
  }
}

// Runs headless Claude Code, so the rephrase uses the Claude subscription rather than an API key.
// It starts outside the repo so the project's CLAUDE.md files stay out of the prompt.
function runClaude(input: string, model: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p',
        '--model', model,
        '--system-prompt-file', PROMPT_PATH,
        '--tools', '',
        '--strict-mcp-config',
        '--disable-slash-commands',
        '--no-session-persistence',
        '--output-format', 'json',
      ],
      { cwd: os.tmpdir(), timeout: CLAUDE_TIMEOUT_MS, signal },
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (exitCode) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      if (exitCode !== 0) {
        const details = parseReply(stdout)?.result || stdout || Buffer.concat(stderrChunks).toString('utf8');
        reject(new Error(`claude -p exited with ${exitCode}: ${details.slice(0, MAX_ERROR_PREVIEW_CHARS)}`));
        return;
      }
      const reply = parseReply(stdout);
      if (!reply) {
        reject(new Error(`claude -p printed something other than its JSON reply: ${stdout.slice(0, MAX_ERROR_PREVIEW_CHARS)}`));
        return;
      }
      if (reply.is_error) {
        reject(new Error(`claude -p failed: ${reply.result.slice(0, MAX_ERROR_PREVIEW_CHARS)}`));
        return;
      }
      resolve(reply.result);
    });
    child.stdin.end(input, 'utf8');
  });
}

async function collectRewrites(round: RewriteRound): Promise<RewriteRound> {
  const pendingNumbers = round.paragraphs
    .map((_, index) => index + 1)
    .filter((number) => !round.rewrites.has(number));
  if (pendingNumbers.length === 0 || round.attempt > MAX_ATTEMPTS) return round;
  round.signal?.throwIfAborted();

  if (round.attempt > 1) {
    console.log(`    Asking again for ${pendingNumbers.length} skipped paragraph(s) (attempt ${round.attempt}/${MAX_ATTEMPTS})...`);
  }
  const response = await runClaude(numberParagraphs(round.paragraphs, pendingNumbers), round.model, round.signal);
  const found = parseRewrites(response, new Set(pendingNumbers));
  return collectRewrites({
    ...round,
    rewrites: new Map([...round.rewrites, ...found]),
    attempt: round.attempt + 1,
    lastReply: response,
  });
}

// A reply with no numbered line at all (a refusal, a changed format) stops the run rather than
// saving the whole chunk unrephrased as if it were done.
export async function rephraseWithClaude(paragraphs: readonly string[], model: string, signal?: AbortSignal): Promise<ClaudeRephrase> {
  const finalRound = await collectRewrites({ paragraphs, model, signal, rewrites: new Map(), attempt: 1, lastReply: '' });
  if (paragraphs.length > 0 && finalRound.rewrites.size === 0) {
    const preview = finalRound.lastReply.slice(0, MAX_ERROR_PREVIEW_CHARS);
    throw new Error(`Claude returned no numbered rewrite in ${MAX_ATTEMPTS} attempts. Last reply: ${preview}`);
  }
  return {
    text: formatPairs(paragraphs, finalRound.rewrites),
    skippedParagraphs: paragraphs.filter((_, index) => !finalRound.rewrites.has(index + 1)),
    attempts: finalRound.attempt - 1,
  };
}
