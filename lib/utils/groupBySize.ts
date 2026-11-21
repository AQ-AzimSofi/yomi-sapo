interface SizedGroup<T> {
  items: T[];
  size: number;
}

/**
 * Splits items, in order, into consecutive groups whose sizes add up to at most
 * maxGroupSize. An item larger than maxGroupSize gets a group of its own.
 */
export function groupBySize<T>(items: readonly T[], sizeOf: (item: T) => number, maxGroupSize: number): T[][] {
  const groups = items.reduce<SizedGroup<T>[]>((closed, item) => {
    const size = sizeOf(item);
    const last = closed.at(-1);
    if (last === undefined || last.size + size > maxGroupSize) {
      return [...closed, { items: [item], size }];
    }
    return [...closed.slice(0, -1), { items: [...last.items, item], size: last.size + size }];
  }, []);
  return groups.map((group) => group.items);
}
