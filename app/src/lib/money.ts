/**
 * Money math for My Business Invoice Desk.
 *
 * RULE: all monetary values are integers in minor units (cents).
 * Never use binary floating point as the source of truth for totals.
 * Decimal quantities (e.g. "33.3") are handled as rational numbers
 * (numerator/denominator) with half-up rounding.
 */

/** Parse a decimal string like "33.3" or "-12.50" into { num, den } with den > 0. */
export function parseDecimal(s: string): { num: bigint; den: bigint } {
  const t = s.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new Error(`Invalid decimal: ${s}`);
  const negative = t.startsWith('-');
  const digits = negative ? t.slice(1) : t;
  const [whole, frac = ''] = digits.split('.');
  const den = 10n ** BigInt(frac.length);
  const num = BigInt(whole + frac);
  return { num: negative ? -num : num, den };
}

/** Convert a dollar string ("75.00", "49.99") to integer cents. Half-up on magnitude. */
export function dollarsToCents(dollars: string): number {
  const { num, den } = parseDecimal(dollars);
  const negative = num < 0n;
  const mag = negative ? -num : num;
  const scaled = mag * 100n;
  const q = scaled / den;
  const r = scaled % den;
  const rounded = r * 2n >= den ? q + 1n : q;
  const result = negative ? -rounded : rounded;
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new Error('Amount out of range');
  }
  return Number(result);
}

/** Integer cents -> "1,234.56" display string. */
export function centsToDollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const d = Math.floor(abs / 100);
  const c = abs % 100;
  return `${sign}${d.toLocaleString('en-US')}.${String(c).padStart(2, '0')}`;
}

/** unit_price_cents * quantity(decimal string) -> line cents, half-up. */
export function multiplyQuantity(unitCents: number, quantity: string): number {
  if (!Number.isInteger(unitCents) || unitCents < 0) throw new Error('unitCents must be a non-negative integer');
  const { num, den } = parseDecimal(quantity);
  if (num <= 0n) throw new Error('quantity must be positive');
  const raw = BigInt(unitCents) * num;
  const q = raw / den;
  const r = raw % den;
  return Number(r * 2n >= den ? q + 1n : q);
}

/** amount_cents * rate(decimal string, e.g. "0.10" for 10%) -> cents, half-up. */
export function percentOf(amountCents: number, rate: string): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error('amountCents must be a non-negative integer');
  const { num, den } = parseDecimal(rate);
  if (num < 0n) throw new Error('rate must be non-negative');
  const raw = BigInt(amountCents) * num;
  const q = raw / den;
  const r = raw % den;
  return Number(r * 2n >= den ? q + 1n : q);
}

/** amount_cents * (num/den) -> cents, half-up. Internal use for prorating. */
function multiplyFraction(amountCents: number, num: bigint, den: bigint): number {
  const raw = BigInt(amountCents) * num;
  const q = raw / den;
  const r = raw % den;
  return Number(r * 2n >= den ? q + 1n : q);
}

export interface CalcLine {
  quantity: string; // decimal string
  unitPriceCents: number;
  discountCents?: number; // line-level discount (mutually exclusive with invoice discount)
  taxRate?: string; // decimal string, e.g. "0.06"
}

export interface CalcResult {
  subtotalCents: number;
  lineDiscountCents: number;
  invoiceDiscountCents: number;
  discountCents: number; // total discount applied
  taxableCents: number;
  taxByRate: { rate: string; cents: number }[];
  taxCents: number;
  shippingCents: number;
  totalCents: number;
}

/**
 * Calculation order (documented, tested):
 *  1. line total = round(qty * unit_price)
 *  2. subtotal = sum(line totals)
 *  3. discount = EITHER sum(line discounts) OR invoice discount % of subtotal (never both)
 *  4. taxable = subtotal - discount
 *  5. tax per line = round((line_total - line_discount) * line_tax_rate), grouped by rate
 *     (invoice-level tax rate is applied as each line's rate when set)
 *  6. total = taxable + tax + shipping
 */
export function calculateInvoiceTotals(
  lines: CalcLine[],
  opts: { invoiceDiscountRate?: string; invoiceTaxRate?: string; shippingCents?: number } = {},
): CalcResult {
  const shippingCents = opts.shippingCents ?? 0;
  if (!Number.isInteger(shippingCents) || shippingCents < 0) throw new Error('shipping must be a non-negative integer');

  const lineTotals = lines.map((l) => multiplyQuantity(l.unitPriceCents, l.quantity));
  const subtotalCents = lineTotals.reduce((a, b) => a + b, 0);

  const lineDiscountCents = lines.reduce((a, l) => a + (l.discountCents ?? 0), 0);
  const hasInvoiceDiscount = opts.invoiceDiscountRate != null && parseDecimal(opts.invoiceDiscountRate).num > 0n;
  if (lineDiscountCents > 0 && hasInvoiceDiscount) {
    throw new Error('Use either line discounts or an invoice discount, not both.');
  }
  const invoiceDiscountCents = hasInvoiceDiscount ? percentOf(subtotalCents, opts.invoiceDiscountRate!) : 0;
  const discountCents = lineDiscountCents + invoiceDiscountCents;
  if (discountCents > subtotalCents) throw new Error('Discount cannot exceed subtotal.');

  const taxableCents = subtotalCents - discountCents;

  // Tax grouped by rate. Line net = line total minus its share of discount.
  // Line discounts reduce that line's net directly; an invoice discount is
  // prorated across lines by their share of the subtotal.
  const taxByRate = new Map<string, number>();
  lines.forEach((l, i) => {
    const rate = l.taxRate ?? opts.invoiceTaxRate ?? '0';
    const lineNet = lineTotals[i] - (l.discountCents ?? 0);
    let net = lineNet;
    if (invoiceDiscountCents > 0 && subtotalCents > 0) {
      const share = multiplyFraction(invoiceDiscountCents, BigInt(lineTotals[i]), BigInt(subtotalCents));
      net = lineNet - share;
    }
    if (net < 0) net = 0;
    const tax = percentOf(net, rate);
    if (tax > 0) taxByRate.set(rate, (taxByRate.get(rate) ?? 0) + tax);
  });

  const taxGroups = [...taxByRate.entries()]
    .map(([rate, cents]) => ({ rate, cents }))
    .sort((a, b) => b.cents - a.cents);
  const taxCents = taxGroups.reduce((a, g) => a + g.cents, 0);
  const totalCents = taxableCents + taxCents + shippingCents;

  return {
    subtotalCents,
    lineDiscountCents,
    invoiceDiscountCents,
    discountCents,
    taxableCents,
    taxByRate: taxGroups,
    taxCents,
    shippingCents,
    totalCents,
  };
}

/** Remaining balance after payments. */
/** Convert a percent string like "3" or "2.5" to a rate string like "0.03" / "0.025". */
export function pctToRate(pct: string): string {
  const t = pct.trim();
  if (!t) return '0';
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error('percent must be a non-negative decimal');
  return String(Number(t) / 100);
}

export interface CommissionTotals {
  commissionCents: number;
  processingFeeCents: number;
  otherChargeCents: number;
  totalCents: number;
}

/**
 * Commission invoice math (Dania Realty template):
 *   commission = round(sale_price * pct / 100), half-up
 *   total = commission + processing_fee + other_charge
 * All inputs and outputs are integer cents.
 */
export function calculateCommissionTotals(
  salePriceCents: number,
  commissionPct: string,
  processingFeeCents: number,
  otherChargeCents: number,
): CommissionTotals {
  if (!Number.isInteger(salePriceCents) || salePriceCents < 0)
    throw new Error('salePriceCents must be a non-negative integer');
  if (!Number.isInteger(processingFeeCents) || processingFeeCents < 0)
    throw new Error('processingFeeCents must be a non-negative integer');
  if (!Number.isInteger(otherChargeCents) || otherChargeCents < 0)
    throw new Error('otherChargeCents must be a non-negative integer');
  const commissionCents = percentOf(salePriceCents, pctToRate(commissionPct));
  return {
    commissionCents,
    processingFeeCents,
    otherChargeCents,
    totalCents: commissionCents + processingFeeCents + otherChargeCents,
  };
}

export function balanceDue(totalCents: number, paidCents: number): number {
  if (paidCents > totalCents) throw new Error('Payment exceeds balance.');
  return totalCents - paidCents;
}
