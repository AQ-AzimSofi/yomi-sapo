import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { getNarration } from '@/lib/db/narrationQueries.sql';
import { GET } from './route';

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {},
  GetObjectCommand: class {
    constructor(readonly input: unknown) {}
  },
  NoSuchKey: class extends Error {},
  NotFound: class extends Error {},
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }));
vi.mock('@/lib/db/narrationQueries.sql', () => ({ getNarration: vi.fn() }));

const OWNER_HEADERS = await ownerSessionHeaders();
const BOOK = { directory: 'bookv2-furigana', fileName: '自分を否定しない習慣' };
const NARRATION_ROW = { audio_key: 'jibun.m4a', unit_count: 2, cues: [{ start: 0, end: 1.5 }, null] };

function narrationRequest(query: string): Request {
  return new Request(`http://localhost/api/narration?${query}`, { headers: OWNER_HEADERS });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.stubEnv('NARRATION_AUDIO_BUCKET', 'narration-audio');
  vi.mocked(getNarration).mockResolvedValue(NARRATION_ROW);
  vi.mocked(getSignedUrl).mockResolvedValue('https://narration-audio.s3/jibun.m4a?X-Amz-Signature=abc');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/narration', () => {
  it('returns the manifest with a 12-hour presigned URL for the recording', async () => {
    const query = new URLSearchParams(BOOK).toString();

    const response = await GET(narrationRequest(query));

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      audioUrl: 'https://narration-audio.s3/jibun.m4a?X-Amz-Signature=abc',
      unitCount: 2,
      cues: [{ start: 0, end: 1.5 }, null],
    });
    expect(getNarration).toHaveBeenCalledWith(BOOK.fileName, BOOK.directory);
    const [, command, options] = vi.mocked(getSignedUrl).mock.calls[0];
    expect((command as unknown as { input: unknown }).input).toStrictEqual({ Bucket: 'narration-audio', Key: 'jibun.m4a' });
    expect(options).toStrictEqual({ expiresIn: 12 * 60 * 60 });
  });

  it('answers 400 without a lookup when the book is missing a param', async () => {
    const response = await GET(narrationRequest(`fileName=${encodeURIComponent(BOOK.fileName)}`));

    expect(response.status).toBe(400);
    expect(getNarration).not.toHaveBeenCalled();
  });
});
