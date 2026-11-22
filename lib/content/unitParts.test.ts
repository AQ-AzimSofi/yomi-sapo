import { describe, expect, it } from 'vitest';
import { hasIllustration, splitUnitParts } from './unitParts';

const texts = (unitText: string) =>
  splitUnitParts(unitText).map((part) => (part.kind === 'text' ? part.text : `[${part.name}]`));

describe('splitUnitParts', () => {
  it('keeps a unit without illustrations as one text run', () => {
    expect(texts('一文目。二文目。')).toEqual(['一文目。二文目。']);
  });

  it('cuts the text around each illustration, in order', () => {
    expect(texts('前。[IMAGE:a.jpg]間。[IMAGE:b.png]後。')).toEqual(['前。', '[a.jpg]', '間。', '[b.png]', '後。']);
  });

  it('drops blank runs but keeps the whitespace inside a run', () => {
    expect(texts(' [IMAGE:a.jpg]\n\n[IMAGE:b.jpg] 後。\n')).toEqual(['[a.jpg]', '[b.jpg]', ' 後。\n']);
  });

  it('gives nothing for a blank unit', () => {
    expect(splitUnitParts('  ')).toEqual([]);
  });

  it('cuts each run into the sentences a reader can click, counting repeats', () => {
    expect(splitUnitParts('はい。いいえ。はい。')).toEqual([
      {
        kind: 'text',
        text: 'はい。いいえ。はい。',
        sentences: [
          { text: 'はい。', occurrence: 0 },
          { text: 'いいえ。', occurrence: 0 },
          { text: 'はい。', occurrence: 1 },
        ],
      },
    ]);
  });

  it('counts a repeated sentence across the illustrations of its unit', () => {
    const sentences = splitUnitParts('はい。そうか。[IMAGE:a.jpg]はい。分かった。[IMAGE:b.jpg]はい。').flatMap((part) =>
      part.kind === 'text' ? part.sentences.map((sentence) => `${sentence.text}${sentence.occurrence}`) : []
    );

    expect(sentences).toEqual(['はい。0', 'そうか。0', 'はい。1', '分かった。0', 'はい。2']);
  });
});

describe('hasIllustration', () => {
  it('tells a unit with an illustration from one without', () => {
    expect(hasIllustration(splitUnitParts('前。[IMAGE:a.jpg]'))).toBe(true);
    expect(hasIllustration(splitUnitParts('前。'))).toBe(false);
  });
});
