import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const s3Send = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = s3Send;
  },
  GetObjectCommand: class {
    constructor(readonly input: unknown) {}
  },
  NoSuchKey: class extends Error {},
}));

const COVER_URL = 'http://localhost/api/covers?directory=bookv2-furigana&fileName=%E3%81%BB%E3%82%93';
const COVER_BYTES = new Uint8Array([0xff, 0xd8, 0xff]);

beforeEach(() => {
  vi.stubEnv('BOOK_COVERS_BUCKET', 'book-covers');
  s3Send.mockResolvedValue({ Body: { transformToByteArray: async () => COVER_BYTES } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/covers', () => {
  it('serves the cover from the covers/ prefix as a day-cached public JPEG', async () => {
    const response = await GET(new Request(COVER_URL));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400, s-maxage=86400');
    expect(new Uint8Array(await response.arrayBuffer())).toStrictEqual(COVER_BYTES);
    expect(s3Send.mock.calls[0][0].input).toStrictEqual({ Bucket: 'book-covers', Key: 'covers/bookv2-furigana/ほん.jpg' });
  });

  it('answers 404 for a book without a cover', async () => {
    const { NoSuchKey } = await import('@aws-sdk/client-s3');
    s3Send.mockRejectedValue(new NoSuchKey({ message: 'missing', $metadata: {} }));

    const response = await GET(new Request(COVER_URL));

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({ error: { code: 'not_found', message: 'No cover for this book' } });
  });

  it('answers 400 without reading storage when the book is missing a param', async () => {
    const response = await GET(new Request('http://localhost/api/covers?directory=bookv2-furigana'));

    expect(response.status).toBe(400);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('answers a generic 500 when storage fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    s3Send.mockRejectedValue(new Error('AccessDenied: arn:aws:s3:::book-covers'));

    const response = await GET(new Request(COVER_URL));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('arn:aws');
    error.mockRestore();
  });
});
