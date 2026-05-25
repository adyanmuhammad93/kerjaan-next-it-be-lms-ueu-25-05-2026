import crypto from 'crypto';

function base64UrlEncode(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function getKey(keyBase64: string) {
  if (!keyBase64) return null;
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) return null;
  return key;
}

export function encryptString(plainText: string, keyBase64: string) {
  const key = getKey(keyBase64);
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return base64UrlEncode(Buffer.concat([iv, tag, encrypted]));
}

export function decryptString(cipherText: string, keyBase64: string) {
  const key = getKey(keyBase64);
  if (!key) return null;
  const buf = base64UrlDecode(cipherText);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

export function encryptJson(value: unknown, keyBase64: string) {
  return encryptString(JSON.stringify(value), keyBase64);
}

export function decryptJson<T = any>(cipherText: string, keyBase64: string): T | null {
  const plain = decryptString(cipherText, keyBase64);
  if (!plain) return null;
  try {
    return JSON.parse(plain) as T;
  } catch {
    return null;
  }
}

