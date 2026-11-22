// Removing readings tag by tag keeps every base character of multi-part ruby such as
// <ruby>一<rt>いつ</rt>色<rt>しき</rt></ruby>, which EPUBs use for names.
export function stripRubyTags(text: string): string {
  return text.replace(/<rp>[^<]*<\/rp>|<rt>[^<]*<\/rt>/g, '').replace(/<\/?(ruby|rb)>/g, '');
}

export function chunkText(text: string, targetSize: number = 5000): { chunks: string[]; boundaries: { start: number; end: number }[] } {
  const paragraphs = text.split(/\n\s*\n/);

  const chunks: string[] = [];
  const boundaries: { start: number; end: number }[] = [];

  let currentChunk = '';
  let currentChunkStripped = '';
  let chunkStart = 0;
  let currentPos = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i].trim();
    if (!paragraph) continue;

    const paragraphStripped = stripRubyTags(paragraph);
    const separator = currentChunk ? '\n\n' : '';

    if (currentChunkStripped.length + paragraphStripped.length + separator.length > targetSize) {
      if (currentChunk) {
        chunks.push(currentChunk);
        boundaries.push({ start: chunkStart, end: currentPos });
        chunkStart = currentPos;
        currentChunk = '';
        currentChunkStripped = '';
      }

      if (paragraphStripped.length > targetSize) {
        const sentences = paragraph.split(/(?<=[。！？])/);
        let sentenceChunk = '';
        let sentenceChunkStripped = '';

        for (const sentence of sentences) {
          const sentenceStripped = stripRubyTags(sentence);

          if (sentenceChunkStripped.length + sentenceStripped.length > targetSize && sentenceChunk) {
            chunks.push(sentenceChunk);
            boundaries.push({ start: chunkStart, end: currentPos });
            chunkStart = currentPos;
            sentenceChunk = sentence;
            sentenceChunkStripped = sentenceStripped;
          } else {
            sentenceChunk += sentence;
            sentenceChunkStripped += sentenceStripped;
          }
        }

        if (sentenceChunk) {
          currentChunk = sentenceChunk;
          currentChunkStripped = sentenceChunkStripped;
        }
      } else {
        currentChunk = paragraph;
        currentChunkStripped = paragraphStripped;
      }
    } else {
      currentChunk += separator + paragraph;
      currentChunkStripped += separator + paragraphStripped;
    }

    currentPos += paragraph.length + 2;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
    boundaries.push({ start: chunkStart, end: currentPos });
  }

  return { chunks, boundaries };
}
