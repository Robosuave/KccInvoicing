import { describe, expect, it } from 'vitest';
import {
  balanceDue,
  calculateCommissionTotals,
  calculateInvoiceTotals,
  centsToDollars,
  dollarsToCents,
  multiplyQuantity,
  pctToRate,
  percentOf,
} from '../lib/money';

describe('dollarsToCents', () => {
  it('converts exact values', () => {
    expect(dollarsToCents('75.00')).toBe(7500);
    expect(dollarsToCents('0.01')).toBe(1);
    expect(dollarsToCents('2.99')).toBe(299);
  });
  it('rounds half-up', () => {
    expect(dollarsToCents('10.005')).toBe(1001);
    expect(dollarsToCents('10.004')).toBe(1000);
  });
  it('accepts commas and a leading $', () => {
    expect(dollarsToCents('225,000.00')).toBe(22500000);
    expect(dollarsToCents('$1,234.56')).toBe(123456);
  });
  it('rejects garbage', () => {
    expect(() => dollarsToCents('abc')).toThrow();
    expect(() => dollarsToCents('12.34.56')).toThrow();
  });
});

describe('multiplyQuantity', () => {
  it('handles decimal quantities exactly (legacy case: 33.3 x $150.00)', () => {
    expect(multiplyQuantity(15000, '33.3')).toBe(499500);
  });
  it('handles whole quantities', () => {
    expect(multiplyQuantity(3900, '8')).toBe(31200);
  });
  it('rounds half-up on fractional cents', () => {
    // 1 x $0.015 -> 1.5c -> 2c
    expect(multiplyQuantity(1, '1.5')).toBe(2);
  });
  it('rejects non-positive quantities', () => {
    expect(() => multiplyQuantity(100, '0')).toThrow();
    expect(() => multiplyQuantity(100, '-2')).toThrow();
  });
});

describe('percentOf', () => {
  it('computes 10% of $200.00', () => {
    expect(percentOf(20000, '0.10')).toBe(2000);
  });
  it('computes 6% of $180.00', () => {
    expect(percentOf(18000, '0.06')).toBe(1080);
  });
  it('computes 7% Broward tax', () => {
    expect(percentOf(530700, '0.07')).toBe(37149);
  });
});

describe('calculateInvoiceTotals — spec acceptance case', () => {
  it('Line 1: 2 x $75.00, Line 2: 1 x $50.00, 10% discount, 6% tax, $100 payment', () => {
    const r = calculateInvoiceTotals(
      [
        { quantity: '2', unitPriceCents: 7500 },
        { quantity: '1', unitPriceCents: 5000 },
      ],
      { invoiceDiscountRate: '0.10', invoiceTaxRate: '0.06' },
    );
    expect(r.subtotalCents).toBe(20000); // $200.00
    expect(r.discountCents).toBe(2000); // $20.00
    expect(r.taxableCents).toBe(18000); // $180.00
    expect(r.taxCents).toBe(1080); // $10.80
    expect(r.totalCents).toBe(19080); // $190.80
    expect(balanceDue(r.totalCents, 10000)).toBe(9080); // $90.80
  });
});

describe('calculateInvoiceTotals — rules', () => {
  it('rejects combining line discounts with an invoice discount', () => {
    expect(() =>
      calculateInvoiceTotals([{ quantity: '1', unitPriceCents: 1000, discountCents: 100 }], {
        invoiceDiscountRate: '0.10',
      }),
    ).toThrow(/either line discounts or an invoice discount/);
  });
  it('supports line-level discounts alone', () => {
    const r = calculateInvoiceTotals([{ quantity: '2', unitPriceCents: 5000, discountCents: 1000 }]);
    expect(r.subtotalCents).toBe(10000);
    expect(r.discountCents).toBe(1000);
    expect(r.totalCents).toBe(9000);
  });
  it('groups tax by rate', () => {
    const r = calculateInvoiceTotals([
      { quantity: '1', unitPriceCents: 10000, taxRate: '0.06' },
      { quantity: '1', unitPriceCents: 10000, taxRate: '0.07' },
    ]);
    expect(r.taxByRate).toEqual([
      { rate: '0.07', cents: 700 },
      { rate: '0.06', cents: 600 },
    ]);
    expect(r.taxCents).toBe(1300);
    expect(r.totalCents).toBe(21300);
  });
  it('adds shipping & handling', () => {
    const r = calculateInvoiceTotals([{ quantity: '1', unitPriceCents: 1000 }], { shippingCents: 500 });
    expect(r.totalCents).toBe(1500);
  });
  it('rejects discount exceeding subtotal', () => {
    expect(() =>
      calculateInvoiceTotals([{ quantity: '1', unitPriceCents: 1000 }], { invoiceDiscountRate: '1.50' }),
    ).toThrow(/exceed subtotal/);
  });
  it('legacy invoice math: 33.3 x $150 + 8 x $39, no tax, no shipping', () => {
    const r = calculateInvoiceTotals([
      { quantity: '33.3', unitPriceCents: 15000 },
      { quantity: '8', unitPriceCents: 3900 },
    ]);
    expect(r.subtotalCents).toBe(530700);
    expect(r.totalCents).toBe(530700);
  });
});

describe('balanceDue', () => {
  it('rejects overpayment in v1', () => {
    expect(() => balanceDue(1000, 1001)).toThrow(/exceeds balance/);
  });
});

describe('centsToDollars', () => {
  it('formats with commas', () => {
    expect(centsToDollars(530700)).toBe('5,307.00');
    expect(centsToDollars(19080)).toBe('190.80');
  });
});

describe('pctToRate', () => {
  it('converts whole percents', () => {
    expect(pctToRate('3')).toBe('0.03');
    expect(pctToRate('100')).toBe('1');
  });
  it('converts fractional percents', () => {
    expect(pctToRate('2.5')).toBe('0.025');
  });
  it('treats blank as zero', () => {
    expect(pctToRate('')).toBe('0');
    expect(pctToRate('   ')).toBe('0');
  });
  it('rejects non-numeric input', () => {
    expect(() => pctToRate('abc')).toThrow();
    expect(() => pctToRate('-3')).toThrow();
  });
});

describe('calculateCommissionTotals', () => {
  it('computes commission, fee, and total', () => {
    // $500,000 sale at 3% + $295 fee = $15,000 + $295 = $15,295
    const t = calculateCommissionTotals(50000000, '3', 29500, 0);
    expect(t.commissionCents).toBe(1500000);
    expect(t.processingFeeCents).toBe(29500);
    expect(t.otherChargeCents).toBe(0);
    expect(t.totalCents).toBe(1529500);
  });
  it('includes the other charge', () => {
    const t = calculateCommissionTotals(10000000, '2.5', 29500, 10000);
    expect(t.commissionCents).toBe(250000); // 2.5% of $100,000
    expect(t.totalCents).toBe(250000 + 29500 + 10000);
  });
  it('rounds commission half-up', () => {
    expect(calculateCommissionTotals(1001, '3', 0, 0).commissionCents).toBe(30);
    expect(calculateCommissionTotals(1000, '3', 0, 0).commissionCents).toBe(30);
  });
  it('rejects negative inputs', () => {
    expect(() => calculateCommissionTotals(-1, '3', 0, 0)).toThrow();
    expect(() => calculateCommissionTotals(0, '3', -1, 0)).toThrow();
    expect(() => calculateCommissionTotals(0, '3', 0, -5)).toThrow();
    expect(() => calculateCommissionTotals(0, 'abc', 0, 0)).toThrow();
  });
  it('uses the $ override when given, and it flows into the total', () => {
    // 3% of $500,000 would be $15,000, but the $ box says $14,500
    const t = calculateCommissionTotals(50000000, '3', 29500, 0, 1450000);
    expect(t.commissionCents).toBe(1450000);
    expect(t.totalCents).toBe(1450000 + 29500);
  });
  it('accepts an override of 0', () => {
    const t = calculateCommissionTotals(50000000, '3', 29500, 10000, 0);
    expect(t.commissionCents).toBe(0);
    expect(t.totalCents).toBe(29500 + 10000);
  });
  it('rejects a bad override', () => {
    expect(() => calculateCommissionTotals(0, '3', 0, 0, -1)).toThrow();
    expect(() => calculateCommissionTotals(0, '3', 0, 0, 10.5)).toThrow();
  });
});
