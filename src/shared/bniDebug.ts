import crypto from 'node:crypto';
import { config } from '../config/env.js';

export function isBniDebugEnabled() {
  return config.bniEcollection.debugLog;
}

export function sha256Hex(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function maskEmail(value: unknown) {
  const s = typeof value === 'string' ? value : '';
  const at = s.indexOf('@');
  if (at <= 1) return s ? '***' : '';
  const name = s.slice(0, at);
  const domain = s.slice(at + 1);
  return `${name[0]}***${name[name.length - 1]}@${domain}`;
}

export function maskPhone(value: unknown) {
  const s = typeof value === 'string' ? value : '';
  const digits = s.replace(/\D/g, '');
  if (digits.length <= 4) return s ? '****' : '';
  const last4 = digits.slice(-4);
  return `****${last4}`;
}

export function sanitizeBniPayload(value: any) {
  if (!value || typeof value !== 'object') return value;
  const clone: any = { ...value };
  if ('customer_email' in clone) clone.customer_email = maskEmail(clone.customer_email);
  if ('customer_phone' in clone) clone.customer_phone = maskPhone(clone.customer_phone);
  if ('virtual_account' in clone && typeof clone.virtual_account === 'string') {
    const va = clone.virtual_account;
    clone.virtual_account = va.length <= 6 ? '******' : `${va.slice(0, 3)}******${va.slice(-3)}`;
  }
  return clone;
}

export function bniDebug(event: string, data: Record<string, any>) {
  if (!isBniDebugEnabled()) return;
  const line = { ts: new Date().toISOString(), ns: 'bni', event, ...data };
  console.log(JSON.stringify(line));
}

