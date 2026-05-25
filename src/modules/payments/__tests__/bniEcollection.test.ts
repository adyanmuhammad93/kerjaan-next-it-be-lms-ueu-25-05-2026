import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

let bniEncrypt: (payload: any, clientId: string, secretKey: string) => string;
let bniDecrypt: <T = any>(cipherText: string, clientId: string, secretKey: string, timeDiffLimitSec: number) => T | null;

beforeAll(async () => {
  process.env.DB_NAME = 'test';
  process.env.DB_USER = 'test';
  process.env.DB_PASSWORD = 'test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  const mod = await import('../bniEcollection.js');
  bniEncrypt = mod.bniEncrypt;
  bniDecrypt = mod.bniDecrypt;
});

afterAll(() => {
  vi.useRealTimers();
});

describe('BNI eCollection crypto', () => {
  it('roundtrips payload with expected timestamp tolerance', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

    const payload = { type: 'createbilling', trx_id: 'BNIABC123', trx_amount: '1000' };
    const cipher = bniEncrypt(payload, '001', 'ea0c88921fb033387e66ef7d1e82ab83');
    const plain = bniDecrypt<typeof payload>(cipher, '001', 'ea0c88921fb033387e66ef7d1e82ab83', 300);

    expect(plain).toEqual(payload);
  });

  it('rejects payload outside time window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

    const payload = { trx_id: 'BNIABC123' };
    const cipher = bniEncrypt(payload, '001', 'ea0c88921fb033387e66ef7d1e82ab83');

    vi.setSystemTime(new Date('2020-01-01T00:30:00.000Z'));
    const plain = bniDecrypt(cipher, '001', 'ea0c88921fb033387e66ef7d1e82ab83', 300);

    expect(plain).toBeNull();
  });
});
