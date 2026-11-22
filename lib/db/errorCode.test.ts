import { describe, expect, it } from 'vitest';
import { errorCodeOf, isUndefinedTable } from './errorCode';

describe('errorCodeOf', () => {
  it('reads the SQLSTATE of a database error', () => {
    expect(errorCodeOf(Object.assign(new Error('relation does not exist'), { code: '42P01' }))).toBe('42P01');
  });

  it.each([
    ['an error without a code', new Error('boom')],
    ['a numeric code', Object.assign(new Error('boom'), { code: 7 })],
    ['null', null],
    ['a string', '42P01'],
  ])('answers undefined for %s', (_case, error) => {
    expect(errorCodeOf(error)).toBeUndefined();
  });
});

describe('isUndefinedTable', () => {
  it('recognises the error a query on a missing table raises', () => {
    expect(isUndefinedTable(Object.assign(new Error('relation "ruby_registry_entries" does not exist'), { code: '42P01' }))).toBe(true);
  });

  it.each([
    ['a missing column', '42703'],
    ['a write conflict', '40001'],
  ])('refuses %s', (_case, code) => {
    expect(isUndefinedTable(Object.assign(new Error('boom'), { code }))).toBe(false);
  });
});
