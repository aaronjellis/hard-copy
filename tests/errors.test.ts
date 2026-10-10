import { describe, it, expect } from 'vitest';
import { errorMessage } from '../src/lib/errors';

describe('errorMessage', () => {
  it('uses the message of an Error', () => {
    expect(errorMessage(new TypeError('bad input'))).toBe('bad input');
  });

  it('stringifies anything else', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
  });
});
