export type CurrencyCode = 'USD' | 'IDR';

export const currencyDecimals: Record<CurrencyCode, number> = {
  USD: 2,
  IDR: 0,
};

export function parseCurrencyCode(code: any): CurrencyCode {
  return code === 'IDR' ? 'IDR' : 'USD';
}

export function assertSupportedCurrency(code: any): CurrencyCode {
  const c = parseCurrencyCode(code);
  if (c !== 'USD' && c !== 'IDR') throw new Error('Unsupported currency');
  return c;
}

export function normalizeAmount(amount: number, currency: CurrencyCode) {
  const decimals = currencyDecimals[currency];
  const factor = 10 ** decimals;
  return Math.round(amount * factor) / factor;
}

export function validateAmountDecimals(amount: number, currency: CurrencyCode) {
  return Math.abs(normalizeAmount(amount, currency) - amount) < 1e-9;
}

export function toMinorUnits(amount: number, currency: CurrencyCode): bigint {
  if (!Number.isFinite(amount)) throw new Error('Invalid amount');
  const decimals = currencyDecimals[currency];
  const factor = 10 ** decimals;
  return BigInt(Math.round(amount * factor));
}

export function fromMinorUnits(minor: bigint, currency: CurrencyCode): number {
  const decimals = currencyDecimals[currency];
  const factor = 10 ** decimals;
  return Number(minor) / factor;
}

export function convertUsdToIdrMinor(usdCents: bigint, usdIdrRate: number): bigint {
  if (!Number.isFinite(usdIdrRate) || usdIdrRate <= 0) throw new Error('Invalid fx rate');
  const rateMicro = BigInt(Math.round(usdIdrRate * 1_000_000));
  const numerator = usdCents * rateMicro;
  const denom = BigInt(100_000_000);
  return (numerator + denom / BigInt(2)) / denom;
}

