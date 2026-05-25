import { config } from '../../config/env.js';
import crypto from 'node:crypto';
import { bniDebug, sanitizeBniPayload, sha256Hex } from '../../shared/bniDebug.js';

function reverseString(s: string) {
  return s.split('').reverse().join('');
}

function enc(input: string, key: string) {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    const keyIndex = ((i % key.length) - 1 + key.length) % key.length;
    const keyCh = key.charCodeAt(keyIndex);
    out += String.fromCharCode((ch + keyCh) % 128);
  }
  return out;
}

function dec(input: string, key: string) {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    const keyIndex = ((i % key.length) - 1 + key.length) % key.length;
    const keyCh = key.charCodeAt(keyIndex);
    out += String.fromCharCode(((ch - keyCh) + 256) % 128);
  }
  return out;
}

function base64UrlEncode(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

export function bniEncrypt(payload: any, clientId: string, secretKey: string) {
  const nowSec = Math.round(Date.now() / 1000);
  const plain = `${reverseString(String(nowSec))}.${JSON.stringify(payload)}`;
  const once = enc(plain, clientId);
  const twice = enc(once, secretKey);
  const out = base64UrlEncode(Buffer.from(twice, 'utf8'));
  bniDebug('encrypt', {
    now_sec: nowSec,
    plain_len: plain.length,
    plain_sha256: sha256Hex(plain),
    cipher_len: out.length,
    cipher_sha256: sha256Hex(out),
    payload: sanitizeBniPayload(payload),
  });
  return out;
}

export function bniDecrypt<T = any>(cipherText: string, clientId: string, secretKey: string, timeDiffLimitSec: number) {
  const decoded = base64UrlDecode(cipherText).toString('utf8');
  const once = dec(decoded, clientId);
  const twice = dec(once, secretKey);
  const dotIndex = twice.indexOf('.');
  if (dotIndex < 0) return null;
  const tsReversed = twice.slice(0, dotIndex);
  const jsonPart = twice.slice(dotIndex + 1);
  const ts = Number(reverseString(tsReversed));
  if (!Number.isFinite(ts)) return null;
  const now = Math.round(Date.now() / 1000);
  const diff = Math.abs(now - ts);
  if (diff > timeDiffLimitSec) {
    bniDebug('decrypt_time_diff_exceeded', {
      now_sec: now,
      ts_sec: ts,
      diff_sec: diff,
      limit_sec: timeDiffLimitSec,
      cipher_len: cipherText.length,
      cipher_sha256: sha256Hex(cipherText),
    });
    return null;
  }
  try {
    const parsed = JSON.parse(jsonPart) as T;
    bniDebug('decrypt', {
      now_sec: now,
      ts_sec: ts,
      diff_sec: diff,
      cipher_len: cipherText.length,
      cipher_sha256: sha256Hex(cipherText),
      data: sanitizeBniPayload(parsed),
    });
    return parsed;
  } catch {
    return null;
  }
}

export type BniEcollectionWrapper = {
  client_id: string;
  prefix?: string;
  data: string;
};

export class BniEcollectionClient {
  private baseUrl = config.bniEcollection.baseUrl;
  private clientId = config.bniEcollection.clientId;
  private secretKey = config.bniEcollection.secretKey;
  private prefix = config.bniEcollection.prefix;
  private timeDiffLimitSec = config.bniEcollection.timeDiffLimitSec;

  async call<TReq extends Record<string, any>, TRes = any>(request: TReq) {
    if (!this.clientId || !this.secretKey) {
      throw new Error('BNI eCollection client is not configured');
    }
    const requestId = crypto.randomBytes(8).toString('hex');
    const startMs = Date.now();
    bniDebug('call_start', {
      request_id: requestId,
      base_url: this.baseUrl,
      prefix: this.prefix,
      client_id_suffix: this.clientId.slice(-2),
      request: sanitizeBniPayload(request),
    });
    const encrypted = bniEncrypt(request, this.clientId, this.secretKey);
    const body = { client_id: this.clientId, prefix: this.prefix, data: encrypted };
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const rawText = await res.text();
    const json = (() => {
      try {
        return JSON.parse(rawText);
      } catch {
        return null;
      }
    })() as any;
    const durMs = Date.now() - startMs;
    bniDebug('call_http', {
      request_id: requestId,
      http_status: res.status,
      duration_ms: durMs,
      response_text_len: rawText.length,
      response_json: json ? { status: json.status, message: json.message, has_data: typeof json.data === 'string' } : null,
    });
    if (!json || typeof json.status !== 'string') {
      throw new Error('Invalid response from BNI eCollection');
    }
    if (json.status !== '000') {
      bniDebug('call_bni_error', {
        request_id: requestId,
        bni_status: json.status,
        bni_message: json.message,
      });
      return { ok: false as const, status: json.status, message: json.message || 'BNI_ERROR' };
    }
    const data = typeof json.data === 'string'
      ? bniDecrypt<TRes>(json.data, this.clientId, this.secretKey, this.timeDiffLimitSec)
      : (json.data as TRes);
    if (!data) {
      throw new Error('Unable to decrypt BNI response');
    }
    bniDebug('call_success', { request_id: requestId, bni_status: json.status, data: sanitizeBniPayload(data) });
    return { ok: true as const, status: json.status, data };
  }

  decryptIncoming<T = any>(wrapper: any) {
    if (!wrapper || typeof wrapper.data !== 'string' || typeof wrapper.client_id !== 'string') return null;
    if (!this.secretKey) return null;
    bniDebug('incoming_decrypt_start', {
      client_id_suffix: wrapper.client_id.slice(-2),
      cipher_len: wrapper.data.length,
      cipher_sha256: sha256Hex(wrapper.data),
    });
    const res = bniDecrypt<T>(wrapper.data, wrapper.client_id, this.secretKey, this.timeDiffLimitSec);
    bniDebug('incoming_decrypt_end', { ok: Boolean(res) });
    return res;
  }
}
