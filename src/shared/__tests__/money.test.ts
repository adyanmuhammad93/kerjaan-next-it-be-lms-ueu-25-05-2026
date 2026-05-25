import { describe, it, expect } from 'vitest';
import { convertUsdToIdrMinor, fromMinorUnits, toMinorUnits, validateAmountDecimals } from '../money.js';

describe('money', () => {
  it('validates decimals by currency', () => {
    expect(validateAmountDecimals(10, 'IDR')).toBe(true);
    expect(validateAmountDecimals(10.1, 'IDR')).toBe(false);
    expect(validateAmountDecimals(10.12, 'USD')).toBe(true);
    expect(validateAmountDecimals(10.123, 'USD')).toBe(false);
  });

  it('converts USD cents to IDR rupiah with rounding', () => {
    const usd = 1.23;
    const usdCents = toMinorUnits(usd, 'USD');
    const idr = convertUsdToIdrMinor(usdCents, 1000);
    expect(fromMinorUnits(idr, 'IDR')).toBe(1230);
  });
});

