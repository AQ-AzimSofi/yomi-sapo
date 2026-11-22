export interface BookOption {
  directory: string;
  bookName: string;
  label: string;
}

export function registryBookOptions(filesByDirectory: Record<string, string[]>): BookOption[] {
  return Object.entries(filesByDirectory).flatMap(([directory, files]) =>
    files.map((file) => ({ directory, bookName: file, label: `${directory}/${file}` }))
  );
}
