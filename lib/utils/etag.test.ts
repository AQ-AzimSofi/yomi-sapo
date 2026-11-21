import { describe, expect, it } from 'vitest';
import { ifNoneMatchIncludes } from './etag';

const ETAG = '"10-20-full"';

describe('ifNoneMatchIncludes', () => {
  it('matches the same strong tag', () => {
    expect(ifNoneMatchIncludes('"10-20-full"', ETAG)).toBe(true);
  });

  it('matches the weak form CloudFront sends after compressing the response', () => {
    expect(ifNoneMatchIncludes('W/"10-20-full"', ETAG)).toBe(true);
  });

  it('matches the tag inside a list', () => {
    expect(ifNoneMatchIncludes('"other", W/"10-20-full"', ETAG)).toBe(true);
  });

  it('matches "*"', () => {
    expect(ifNoneMatchIncludes('*', ETAG)).toBe(true);
  });

  it.each([null, '', '"10-20-preview5"', '"other", "10-21-full"'])('does not match %j', (header) => {
    expect(ifNoneMatchIncludes(header, ETAG)).toBe(false);
  });
});
