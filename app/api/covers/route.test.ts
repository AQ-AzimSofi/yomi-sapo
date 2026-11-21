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

beforeEach(() => {
  vi.stubEnv('BOOK_COVERS_BUCKET', 'book-covers');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/covers', () => {
  it('answers a generic 500 when storage fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    s3Send.mockRejectedValue(new Error('AccessDenied: arn:aws:s3:::book-covers'));

    const response = await GET(new Request(COVER_URL));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('arn:aws');
    error.mockRestore();
  });
});
