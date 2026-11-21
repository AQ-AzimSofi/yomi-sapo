import { GoogleGenAI } from '@google/genai';
import { AI_MODELS, VN_RETRY_CONFIG } from '../../lib/constants';
import { alignRephrase, parseMarkdown, type AlignReport } from '../utils/rephrase-output';
import { rephraseWithClaude, splitParagraphs } from '../utils/claude-rephrase';
import { stripRubyTags } from './chunking';

// Model fallback order: try gemini-3-flash-preview first, then 2.5-flash, then 2.5-flash-lite
const MODEL_FALLBACK_ORDER = [
  AI_MODELS.GEMINI_3_FLASH_PREVIEW,
  AI_MODELS.GEMINI_2_5_FLASH,
  AI_MODELS.GEMINI_2_5_FLASH_LITE,
];

const ai_instructions = `
以下の文章について、日本語学習者が意味を掴みやすくするために、元の一行ごとに要約してください。回答は必ず下記の構成に従ってください。

<（原文）
>>元の文のメッセージを要約してください。

一行ずつ、このフォーマットを繰り返してください。

例：
< かつて１０００年の都と謳われた古都のはずれに、世界はどこまでもシンプルであり、人は今日からでも幸せになれる、と説く哲学者が住んでいた。
>> 古都のはずれに、「世界はシンプルで人は幸せになれる」と説く哲学者が住んでいた。

< 納得のいかない青年は、哲学者のもとを訪ね、その真意を問いただそうとしていた。
>> その教えに納得できない青年が、哲学者の本当の考えを聞きに行った。

< 悩み多き彼の目には、世界は矛盾に満ちた混沌としか映らず、ましてや幸福などありえなかった。
>> 悩みの多い青年には、世界は複雑で、幸せになれるとは思えなかった。

---
それでは、以下の文章でお願いします：
`;

function validateResponse(response: string): boolean {
  const items = parseMarkdown(response);
  if (items.length === 0) return false;
  return items.every(item =>
    item.head && item.head.length > 0 && item.subItems.length >= 1
  );
}

function logAlignReport(report: AlignReport): void {
  const summary = [
    `${report.strayLines.length} stray line(s) dropped`,
    `${report.restoredHeadCount} original(s) restored`,
    `${report.insertedPassages.length} skipped passage(s) put back`,
    `${report.unmatchedHeads.length} unmatched`,
  ].join(', ');
  console.log(`  Output check: ${summary}`);
  report.insertedPassages.forEach((passage) => console.log(`    + ${passage.slice(0, 60)}`));
  report.unmatchedHeads.forEach((head) => console.log(`    ? ${head.slice(0, 60)}`));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Multiple API key support for faster processing
let aiClients: GoogleGenAI[] = [];
export let currentClientIndex = 0;

function initializeAIClients(): void {
  if (aiClients.length > 0) return;

  // Collect all GEMINI_API_KEY* environment variables
  const keys: string[] = [];

  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  if (process.env.GEMINI_API_KEY2) keys.push(process.env.GEMINI_API_KEY2);
  if (process.env.GEMINI_API_KEY3) keys.push(process.env.GEMINI_API_KEY3);
  if (process.env.GEMINI_API_KEY4) keys.push(process.env.GEMINI_API_KEY4);
  if (process.env.GEMINI_API_KEY5) keys.push(process.env.GEMINI_API_KEY5);

  if (keys.length === 0) {
    throw new Error('No GEMINI_API_KEY environment variables set');
  }

  console.log(`Initialized ${keys.length} API key(s) for rotation`);
  aiClients = keys.map(apiKey => new GoogleGenAI({ apiKey }));
}

function getAIClient(): GoogleGenAI {
  initializeAIClients();
  return aiClients[currentClientIndex];
}

export function rotateAIClient(): void {
  initializeAIClients();
  currentClientIndex = (currentClientIndex + 1) % aiClients.length;
}

export function getApiKeyCount(): number {
  initializeAIClients();
  return aiClients.length;
}

async function processChunk(
  chunk: string,
  model: string,
  maxAttempts: number = VN_RETRY_CONFIG.MAX_ATTEMPTS
): Promise<{ success: boolean; response: string; attempts: number; usedModel?: string }> {
  const ai = getAIClient();
  const cleanChunk = stripRubyTags(chunk);

  // Build model fallback list: start with requested model, then add fallbacks
  const modelsToTry = [model];
  for (const fallbackModel of MODEL_FALLBACK_ORDER) {
    if (!modelsToTry.includes(fallbackModel)) {
      modelsToTry.push(fallbackModel);
    }
  }

  for (const currentModel of modelsToTry) {
    let currentInstruction = ai_instructions;
    let attempt = 0;

    console.log(`    Trying model: ${currentModel}`);

    while (attempt < maxAttempts) {
      attempt++;
      console.log(`    Attempt ${attempt}/${maxAttempts}...`);

      try {
        const response = await ai.models.generateContent({
          model: currentModel,
          contents: currentInstruction + cleanChunk,
        });

        const responseText = response.text || '';

        if (validateResponse(responseText)) {
          if (currentModel !== model) {
            console.log(`    Success with fallback model: ${currentModel}`);
          }
          return { success: true, response: responseText, attempts: attempt, usedModel: currentModel };
        }

        console.log('    Invalid format, retrying with correction prompt...');
        console.log('    Response preview:', responseText.slice(0, 200).replace(/\n/g, '\\n'));
        currentInstruction =
          '回答のフォーマットが正しくありません。もう一度やり直してください。必ず下記の構成に従ってください。\n' +
          ai_instructions;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`    API error on attempt ${attempt}:`, errorMessage);

        // Check if it's a model-specific error (not found, quota, etc.)
        if (errorMessage.includes('not found') || errorMessage.includes('404') ||
            errorMessage.includes('quota') || errorMessage.includes('rate limit')) {
          console.log(`    Model ${currentModel} unavailable, trying next fallback...`);
          break; // Try next model
        }

        if (attempt < maxAttempts) {
          const waitTime = Math.min(30, attempt * 10);
          console.log(`    Waiting ${waitTime}s before retry...`);
          await sleep(waitTime * 1000);
        }
      }
    }
  }

  return { success: false, response: '', attempts: maxAttempts * modelsToTry.length };
}

export interface ChunkOutput {
  rawText: string;
  readerText: string;
  attempts: number;
  error?: string;
}

export async function rephraseChunkWithGemini(chunk: string, model: string): Promise<ChunkOutput> {
  const chunkStripped = stripRubyTags(chunk);
  const result = await processChunk(chunk, model);
  if (result.success) {
    const aligned = alignRephrase(chunkStripped, result.response);
    logAlignReport(aligned.report);
    return { rawText: result.response, readerText: aligned.text, attempts: result.attempts };
  }

  // Each line stands in as its own rephrase so no content is skipped
  console.log(`  Failed after ${result.attempts} attempts, using original text as fallback...`);
  const lines = chunkStripped.split('\n').filter(l => l.trim().length > 0);
  const fallbackResponse = lines.map(line => `< ${line}\n>> ${line}`).join('\n\n');
  return {
    rawText: fallbackResponse,
    readerText: fallbackResponse,
    attempts: result.attempts,
    error: 'Used original text (rephrase failed)',
  };
}

// A failed claude -p call (usage limit, sign-in) stops the run; this chunk stays unfinished, so rerunning resumes it.
export async function rephraseChunkWithClaude(chunk: string, model: string): Promise<ChunkOutput> {
  const rephrased = await rephraseWithClaude(splitParagraphs(stripRubyTags(chunk)), model).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}\nProgress is saved. Run the same command again to resume from this chunk.`, { cause: error });
  });
  const skippedCount = rephrased.skippedParagraphs.length;
  rephrased.skippedParagraphs.forEach((paragraph) => console.log(`    ? kept original: ${paragraph.slice(0, 60)}`));
  return {
    rawText: rephrased.text,
    readerText: rephrased.text,
    attempts: rephrased.attempts,
    error: skippedCount > 0 ? `${skippedCount} paragraph(s) kept their original text` : undefined,
  };
}
