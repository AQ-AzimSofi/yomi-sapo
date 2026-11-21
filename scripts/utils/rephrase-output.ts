export interface ParsedItem {
  head: string;
  subItems: string[];
}

export function parseMarkdown(text: string): ParsedItem[] {
  const hasHeadingPrefix = /^[<＜](?!ruby>|rt>)/m.test(text);
  const hasSubItemSeparator = text.includes('>>');

  if (!hasHeadingPrefix && !hasSubItemSeparator) {
    return [];
  }

  const lines = text.split('\n');
  const items: ParsedItem[] = [];
  let currentItem: ParsedItem | null = null;
  let collectingHeader = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (collectingHeader && currentItem) {
        currentItem.head += '\n';
      }
      continue;
    }

    if (/^[<＜]/.test(trimmed) && !/^<ruby>/.test(trimmed)) {
      currentItem = {
        head: trimmed.replace(/^[<＜]\s*/, ''),
        subItems: [],
      };
      items.push(currentItem);
      collectingHeader = true;
    } else if (trimmed.startsWith('>>')) {
      collectingHeader = false;
      if (currentItem) {
        currentItem.subItems.push(trimmed.replace(/^>>\s*/, ''));
      }
    } else if (collectingHeader && currentItem) {
      currentItem.head += '\n' + trimmed;
    }
  }

  return items;
}
