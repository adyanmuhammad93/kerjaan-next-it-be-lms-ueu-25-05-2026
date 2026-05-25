import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { encryptJson, decryptJson } from '../crypto.js';

describe('crypto helpers', () => {
  it('encrypts and decrypts JSON', () => {
    const key = crypto.randomBytes(32).toString('base64');
    const value = { a: 1, b: 'x' };
    const enc = encryptJson(value, key);
    expect(enc).toBeTruthy();
    const dec = decryptJson(enc!, key);
    expect(dec).toEqual(value);
  });
});

