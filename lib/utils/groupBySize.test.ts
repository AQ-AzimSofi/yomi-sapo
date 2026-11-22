import { describe, expect, it } from 'vitest';
import { groupBySize } from './groupBySize';

const sizeOf = (size: number) => size;

describe('groupBySize', () => {
  it('returns no groups for no items', () => {
    expect(groupBySize([], sizeOf, 10)).toEqual([]);
  });

  it('keeps items in order and starts a group when the next item would pass the limit', () => {
    expect(groupBySize([5, 4, 2], sizeOf, 8)).toEqual([[5], [4, 2]]);
  });

  it('fills a group up to exactly the limit', () => {
    expect(groupBySize([3, 5, 1], sizeOf, 8)).toEqual([[3, 5], [1]]);
  });

  it('gives an item larger than the limit a group of its own', () => {
    expect(groupBySize([1, 20, 1], sizeOf, 8)).toEqual([[1], [20], [1]]);
  });
});
