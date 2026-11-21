import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './returnPath';

const READER_PATH = `/read?${new URLSearchParams({ directory: 'bookv2-furigana/本', fileName: '本-rephrase-furigana' })}`;

describe('safeReturnPath', () => {
  it('returns to the reader with its query', () => {
    expect(safeReturnPath(READER_PATH)).toBe(READER_PATH);
  });

  it.each(['/vocabulary', '/library#top', '/read?page=2'])('returns to the same-site path %j', (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([null, ''])('goes home without a path (%j)', (next) => {
    expect(safeReturnPath(next)).toBe('/');
  });

  it.each([
    '//evil.com',
    '//evil.com/read',
    '/\\evil.com',
    '/\\/evil.com',
    '\\\\evil.com',
    'https://evil.com',
    'HTTPS://evil.com/read',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,hi',
    'evil.com',
    'read',
    ' /library',
  ])('goes home instead of to %j, which is not a path on this site', (next) => {
    expect(safeReturnPath(next)).toBe('/');
  });

  it.each([
    '/%2Fevil.com',
    '/%2F%2Fevil.com',
    '/%5Cevil.com',
    '/%5C%5Cevil.com',
    '%2F%2Fevil.com',
    'javascript%3Aalert(1)',
  ])('goes home instead of to the encoded off-site path %j', (next) => {
    expect(safeReturnPath(next)).toBe('/');
  });

  it.each(['/.//evil.com', '/..//evil.com', '/%2e//evil.com', '/%2e%2e//evil.com', '/read/..//evil.com/phish', '/a/b/../..//evil.com'])(
    'goes home instead of to %j, which the URL parser turns into //evil.com',
    (next) => {
      expect(safeReturnPath(next)).toBe('/');
    }
  );

  it('goes home instead of to a path whose dot segments leave an encoded off-site path', () => {
    expect(safeReturnPath('/read/../%2F%2Fevil.com')).toBe('/');
  });

  it('returns to the page a dot segment points at', () => {
    expect(safeReturnPath('/read/../library')).toBe('/library');
  });

  it.each(['/\t/evil.com', '/\n/evil.com', '/%09/evil.com', '/%0d%0a/evil.com', '/library\u0000'])(
    'goes home instead of to %j, which hides a control character',
    (next) => {
      expect(safeReturnPath(next)).toBe('/');
    }
  );

  it('goes home instead of to a path that does not decode', () => {
    expect(safeReturnPath('/read?directory=%E0%A4%A')).toBe('/');
  });

  it.each(['/login', '/login/', '/login?next=%2Flogin', '/login#form'])('goes home instead of back to the login page (%j)', (next) => {
    expect(safeReturnPath(next)).toBe('/');
  });

  it('keeps a page whose name only starts with login', () => {
    expect(safeReturnPath('/login-help')).toBe('/login-help');
  });
});
