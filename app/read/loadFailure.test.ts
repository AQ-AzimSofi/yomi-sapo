import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { describeLoadFailure } from './loadFailure';

describe('describeLoadFailure', () => {
  it("hides the server's reason when it refuses the book", () => {
    const refused = new ApiError({
      status: 403,
      statusText: 'Forbidden',
      body: { error: { code: 'preview_only', message: 'Guests may only open the preview books' } },
      promptedGuestKey: false,
    });

    expect(describeLoadFailure(refused)).toBe('Failed to load content');
  });

  it('shows why a request never reached the server', () => {
    expect(describeLoadFailure(new TypeError('Failed to fetch'))).toBe('Failed to fetch');
  });
});
