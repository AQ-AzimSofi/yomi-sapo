import { ApiError } from '@/lib/api/client';

// The server's reason, such as a guest opening a book outside the preview, is not for the reader.
export function describeLoadFailure(error: unknown): string {
  if (error instanceof ApiError) return 'Failed to load content';
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}
