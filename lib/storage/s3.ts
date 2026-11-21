/**
 * Book storage in S3: covers, illustrations and narration recordings.
 */

import 'server-only';
import { GetObjectCommand, NoSuchKey, NotFound, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// One client per server instance, so warm requests reuse its credentials and connections.
const s3 = new S3Client({});

function isMissingObject(error: unknown): boolean {
  return error instanceof NoSuchKey || error instanceof NotFound;
}

/**
 * The whole object, or null when the bucket has no such key. The body is read
 * fully here: a route that streamed it would commit cacheable 200 headers first,
 * so a failure mid-read would be cached as a truncated file instead of a 500.
 */
export async function readObjectBytes(bucket: string, key: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!object.Body) {
      throw new Error(`Empty object ${key} in ${bucket}`);
    }
    // The copy gives an ArrayBuffer-backed array, which BodyInit accepts.
    return new Uint8Array(await object.Body.transformToByteArray());
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return null;
  }
}

export function presignGet(bucket: string, key: string, expiresInSeconds: number): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresInSeconds });
}
