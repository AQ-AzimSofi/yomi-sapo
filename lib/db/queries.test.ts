import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from '@/lib/db/connection';
import { getTextEntryVersion, upsertBookmark } from './queries';

vi.mock('@/lib/db/connection', () => ({ sql: vi.fn() }));

function queryValues(): unknown[] {
  const [, ...values] = vi.mocked(sql).mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
  return values;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('upsertBookmark', () => {
  it('sends NULL, never undefined, for a bookmark without a page', async () => {
    vi.mocked(sql).mockResolvedValue([] as never);

    await upsertBookmark({ fileName: 'ほん', directory: 'd', bookmarkText: '一文目' });

    expect(queryValues()).toEqual(['ほん', 'd', '一文目', null]);
  });

  it('sends the page it was given', async () => {
    vi.mocked(sql).mockResolvedValue([] as never);

    await upsertBookmark({ fileName: 'ほん', directory: 'd', bookmarkText: '一文目', bookmarkPage: 7 });

    expect(queryValues()).toEqual(['ほん', 'd', '一文目', 7]);
  });
});

describe('getTextEntryVersion', () => {
  it('returns null for a missing book', async () => {
    vi.mocked(sql).mockResolvedValue([] as never);

    expect(await getTextEntryVersion('ほん', 'd')).toBeNull();
  });

  it('changes when only the timestamp changes', async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ bytes: 10, updated_ms: '100' }] as never);
    vi.mocked(sql).mockResolvedValueOnce([{ bytes: 10, updated_ms: '200' }] as never);

    const first = await getTextEntryVersion('ほん', 'd');
    const second = await getTextEntryVersion('ほん', 'd');

    expect(first).toBe('10-100');
    expect(second).toBe('10-200');
  });
});
