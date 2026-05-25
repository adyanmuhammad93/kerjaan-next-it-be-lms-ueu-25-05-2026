import { describe, it, expect, vi, beforeAll } from 'vitest';

let bniEncrypt: (payload: any, clientId: string, secretKey: string) => string;
let bniDecrypt: <T = any>(cipherText: string, clientId: string, secretKey: string, timeDiffLimitSec: number) => T | null;
let legacyEncrypt: (jsonData: any, cid: string, sck: string) => string;
let legacyDecrypt: (hashedString: string, cid: string, sck: string) => any | null;

beforeAll(async () => {
  process.env.DB_NAME = 'test';
  process.env.DB_USER = 'test';
  process.env.DB_PASSWORD = 'test';
  process.env.JWT_SECRET = 'x'.repeat(32);

  const mod = await import('../bniEcollection.js');
  bniEncrypt = mod.bniEncrypt;
  bniDecrypt = mod.bniDecrypt;

  const legacy = await import('../../../../../BniEncryption.js');
  const lib = (legacy as any).default || legacy;
  legacyEncrypt = lib.encrypt;
  legacyDecrypt = lib.decrypt;
});

describe('BNI crypto compatibility', () => {
  it('produces the exact same ciphertext as the legacy lib (fixed time)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

    const cid = '001';
    const sck = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const data = {
      type: 'createbilling',
      trx_amount: 100000,
      customer_name: 'David',
      customer_email: 'david@example.com',
      customer_phone: '08123456781011',
      description: 'Test Create Billing',
      trx_id: 'invoice-0001',
      virtual_account: null,
      billing_type: 'c',
      client_id: cid,
      datetime_expired: new Date('2020-01-01T02:00:00.000Z').toISOString(),
    };

    const legacyCipher = legacyEncrypt(data, cid, sck);
    const newCipher = bniEncrypt(data, cid, sck);

    expect(newCipher).toBe(legacyCipher);

    const legacyPlain = legacyDecrypt(newCipher, cid, sck);
    const newPlain = bniDecrypt(newCipher, cid, sck, 300);

    expect(newPlain).toEqual(data);
    expect(legacyPlain).toEqual(data);
  });
});

