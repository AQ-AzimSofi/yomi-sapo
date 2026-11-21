import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoSuchKey, NotFound, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { presignGet, readObjectBytes } from './s3';

const { s3Send, clientCount } = vi.hoisted(() => ({ s3Send: vi.fn(), clientCount: { value: 0 } }));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = s3Send;
    constructor() {
      clientCount.value += 1;
    }
  },
  GetObjectCommand: class {
    constructor(readonly input: unknown) {}
  },
  NoSuchKey: class extends Error {},
  NotFound: class extends Error {},
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }));

const OBJECT_BYTES = new Uint8Array([0xff, 0xd8, 0xff]);

function objectWithBody(bytes: Uint8Array) {
  return { Body: { transformToByteArray: async () => bytes } };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('readObjectBytes', () => {
  it('returns the bytes of the object at the bucket and key', async () => {
    s3Send.mockResolvedValue(objectWithBody(OBJECT_BYTES));

    const bytes = await readObjectBytes('book-covers', 'covers/d/ほん.jpg');

    expect(bytes).toStrictEqual(OBJECT_BYTES);
    expect(s3Send.mock.calls[0][0].input).toStrictEqual({ Bucket: 'book-covers', Key: 'covers/d/ほん.jpg' });
  });

  it('returns a copy backed by its own ArrayBuffer, which a Response body accepts', async () => {
    s3Send.mockResolvedValue(objectWithBody(OBJECT_BYTES));

    const bytes = await readObjectBytes('book-covers', 'covers/d/ほん.jpg');

    expect(bytes).not.toBe(OBJECT_BYTES);
    expect(bytes?.buffer).toBeInstanceOf(ArrayBuffer);
  });

  it.each([
    ['NoSuchKey', () => new NoSuchKey({ message: 'missing', $metadata: {} })],
    ['NotFound', () => new NotFound({ message: 'missing', $metadata: {} })],
  ])('returns null when storage answers %s', async (_case, missingError) => {
    s3Send.mockRejectedValue(missingError());

    expect(await readObjectBytes('book-covers', 'covers/d/ない.jpg')).toBeNull();
  });

  it('passes any other storage failure on', async () => {
    const accessDenied = new Error('AccessDenied');
    s3Send.mockRejectedValue(accessDenied);

    await expect(readObjectBytes('book-covers', 'covers/d/ほん.jpg')).rejects.toBe(accessDenied);
  });

  it('fails on an object without a body', async () => {
    s3Send.mockResolvedValue({});

    await expect(readObjectBytes('book-covers', 'covers/d/ほん.jpg')).rejects.toThrow('Empty object covers/d/ほん.jpg in book-covers');
  });

  it('reuses one client across reads', async () => {
    s3Send.mockResolvedValue(objectWithBody(OBJECT_BYTES));

    await readObjectBytes('book-covers', 'covers/a.jpg');
    await readObjectBytes('book-images', 'b/images/c.png');

    expect(clientCount.value).toBe(1);
  });
});

describe('presignGet', () => {
  it('signs a GET of the key with the shared client for the given lifetime', async () => {
    vi.mocked(getSignedUrl).mockResolvedValue('https://signed.example/key');

    const url = await presignGet('narration-audio', 'jibun.m4a', 3600);

    expect(url).toBe('https://signed.example/key');
    const [client, command, options] = vi.mocked(getSignedUrl).mock.calls[0];
    expect(client).toBeInstanceOf(S3Client);
    expect((command as unknown as { input: unknown }).input).toStrictEqual({ Bucket: 'narration-audio', Key: 'jibun.m4a' });
    expect(options).toStrictEqual({ expiresIn: 3600 });
    expect(clientCount.value).toBe(1);
  });
});
