import { describe, expect, it } from 'vitest';
import { rubyRegistryKey } from '@/lib/books/bookRef';
import { registryBookOptions } from './registryBookOptions';

describe('registryBookOptions', () => {
  it('names a book by the registry key the reader uses, not by its text file', () => {
    const book = { directory: 'bookv2-furigana/感謝脳', fileName: '感謝脳-rephrase-furigana' };

    expect(registryBookOptions({ [book.directory]: [book.fileName] })).toEqual([
      { ...rubyRegistryKey(book), label: 'bookv2-furigana/感謝脳' },
    ]);
  });

  it('lists a book folder holding two texts once', () => {
    const options = registryBookOptions({ 'bookv2-furigana/感謝脳': ['感謝脳', '感謝脳-rephrase-furigana'] });

    expect(options.map((option) => option.label)).toEqual(['bookv2-furigana/感謝脳']);
  });

  it('leaves out a book stored straight in a top directory, which has no registry', () => {
    expect(registryBookOptions({ 'bookv2-furigana': ['自分を否定しない習慣'] })).toEqual([]);
  });

  it('labels each option the way the registry link from the reader names it', () => {
    const [option] = registryBookOptions({ 'bookv2-furigana/感謝脳': ['感謝脳-rephrase-furigana'] });

    expect(option.label).toBe(`${option.directory}/${option.bookName}`);
  });
});
