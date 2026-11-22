import { rubyRegistryKey } from '@/lib/books/bookRef';

export interface BookOption {
  directory: string;
  bookName: string;
  label: string;
}

/**
 * One option per book folder, named by the registry key the reader opens the registry with. Every
 * text in a folder shares that key, and a book stored straight in a top directory has none.
 */
export function registryBookOptions(filesByDirectory: Record<string, string[]>): BookOption[] {
  return Object.entries(filesByDirectory)
    .flatMap(([directory, [firstFile]]) => (firstFile === undefined ? [] : [rubyRegistryKey({ directory, fileName: firstFile })]))
    .filter((key) => key.bookName !== '')
    .map((key) => ({ ...key, label: `${key.directory}/${key.bookName}` }));
}
