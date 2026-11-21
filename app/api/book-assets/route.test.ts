import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { PUBLIC_BOOKS } from '@/lib/publicBooks';
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

const OWNER_HEADERS = await ownerSessionHeaders();
const PREVIEW_IMAGE = `/${PUBLIC_BOOKS[0].directory}/images/cover.jpg`;
const PRIVATE_IMAGE = '/bookv2-furigana/ほん/images/cover.jpg';
const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff]);

function assetRequest(assetPath: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/book-assets?path=${encodeURIComponent(assetPath)}`, { headers });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.stubEnv('BOOK_IMAGES_BUCKET', 'book-images');
  s3Send.mockResolvedValue({ Body: { transformToByteArray: async () => IMAGE_BYTES } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/book-assets', () => {
  it('refuses a guest an illustration from a book outside the preview without reading storage', async () => {
    const response = await GET(assetRequest(PRIVATE_IMAGE));

    expect(response.status).toBe(403);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('serves a guest an illustration from a preview book', async () => {
    const response = await GET(assetRequest(PREVIEW_IMAGE));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await response.arrayBuffer())).toStrictEqual(IMAGE_BYTES);
  });

  it('serves the signed-in owner an illustration from any book', async () => {
    const response = await GET(assetRequest(PRIVATE_IMAGE, OWNER_HEADERS));

    expect(response.status).toBe(200);
  });

  it('rejects a path that climbs out of the book folders', async () => {
    const response = await GET(assetRequest('/bookv2-furigana/../secret.json', OWNER_HEADERS));

    expect(response.status).toBe(400);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('answers 404 for an asset storage does not have', async () => {
    const { NoSuchKey } = await import('@aws-sdk/client-s3');
    s3Send.mockRejectedValue(new NoSuchKey({ message: 'missing', $metadata: {} }));

    const response = await GET(assetRequest(PRIVATE_IMAGE, OWNER_HEADERS));

    expect(response.status).toBe(404);
  });

  it('answers a generic 500 when storage fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    s3Send.mockRejectedValue(new Error('AccessDenied: arn:aws:s3:::book-images'));

    const response = await GET(assetRequest(PRIVATE_IMAGE, OWNER_HEADERS));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('arn:aws');
    error.mockRestore();
  });
});
