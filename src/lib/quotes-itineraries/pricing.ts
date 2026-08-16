import Decimal from 'decimal.js';
import {
  QuoteLineCategory,
  QuoteLineItem,
} from './types';
import { DECIMAL_STRING_REGEX } from './schemas';

// Configure Decimal.js precision and standard commercial rounding (ROUND_HALF_UP)
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

const MAX_NUMERIC_12_2 = new Decimal('9999999999.99');
const MIN_NUMERIC_12_2 = new Decimal('-9999999999.99');

export interface PricingLineItemInput {
  id?: string;
  title: string;
  description?: string | null;
  category: QuoteLineCategory;
  quantity: number;
  unitPrice: string; // validated decimal string e.g. "12500.00", "50", "10.5"
  supplierCost?: string | null; // validated decimal string e.g. "9000.00"
  supplierName?: string | null;
}

export interface CalculatePricingInput {
  lineItems: PricingLineItemInput[];
  discountAmount?: string | null;
  taxAmount?: string | null;
  currency?: string;
}

export interface CalculatedQuotePricingResult {
  normalizedLineItems: QuoteLineItem[];
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  grandTotal: string;
  internalCostTotal: string | null;
  grossMarginAmount: string | null;
}

/**
 * Pure, deterministic pricing engine for Rihla Quotes.
 *
 * Invariants:
 * 1. Zero DB/network/LLM dependencies.
 * 2. Uses exact Decimal arithmetic with ROUND_HALF_UP (no floating point inaccuracy).
 * 3. Normalizes all accepted decimal strings to canonical 2-decimal representation.
 * 4. Recomputes all totals, markups, margins, and aggregates server-side.
 * 5. Handles unknown supplier costs truth-preserving: internalCostTotal/grossMarginAmount = null if ANY item is missing supplier cost.
 * 6. Validates PostgreSQL numeric(12, 2) bounded range before persistence.
 */
export function calculateQuotePricing(input: CalculatePricingInput): CalculatedQuotePricingResult {
  if (!input.lineItems || input.lineItems.length === 0) {
    throw new Error('PRICING_VALIDATION_ERROR: At least one line item is required.');
  }

  let allSupplierCostsKnown = true;
  let subtotalDec = new Decimal(0);
  let internalCostTotalDec = new Decimal(0);

  const normalizedLineItems: QuoteLineItem[] = [];

  for (let idx = 0; idx < input.lineItems.length; idx++) {
    const item = input.lineItems[idx];

    // 1. Validate quantity
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(
        `PRICING_VALIDATION_ERROR: Line item #${idx + 1} (${item.title || 'Untitled'}) must have a positive integer quantity (received ${item.quantity}).`
      );
    }

    // 2. Validate and normalize unitPrice
    const trimmedUnitPrice = (item.unitPrice || '').trim();
    if (!DECIMAL_STRING_REGEX.test(trimmedUnitPrice)) {
      throw new Error(
        `PRICING_VALIDATION_ERROR: Line item #${idx + 1} has invalid unit price format "${item.unitPrice}". Expected non-negative decimal string.`
      );
    }

    const unitPriceDec = new Decimal(trimmedUnitPrice);
    const qtyDec = new Decimal(item.quantity);
    const lineTotalDec = qtyDec.times(unitPriceDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    subtotalDec = subtotalDec.plus(lineTotalDec);

    // 3. Validate and calculate supplierCost if present
    let normalizedSupplierCost: string | null = null;
    let markupAmountStr: string | null = null;
    let marginAmountStr: string | null = null;
    let marginPct: number | null = null;
    let markupPct: number | null = null;

    if (item.supplierCost !== undefined && item.supplierCost !== null && item.supplierCost.trim() !== '') {
      const trimmedCost = item.supplierCost.trim();
      if (!DECIMAL_STRING_REGEX.test(trimmedCost)) {
        throw new Error(
          `PRICING_VALIDATION_ERROR: Line item #${idx + 1} has invalid supplier cost format "${item.supplierCost}". Expected non-negative decimal string.`
        );
      }

      const supplierCostDec = new Decimal(trimmedCost);
      normalizedSupplierCost = supplierCostDec.toFixed(2);

      const lineInternalCostDec = qtyDec.times(supplierCostDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      internalCostTotalDec = internalCostTotalDec.plus(lineInternalCostDec);

      const markupDec = lineTotalDec.minus(lineInternalCostDec);
      markupAmountStr = markupDec.toFixed(2);
      marginAmountStr = markupDec.toFixed(2);

      // Margin % = (Markup / Line Total) * 100
      if (!lineTotalDec.isZero()) {
        marginPct = markupDec.dividedBy(lineTotalDec).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
      }

      // Markup % = (Markup / Internal Cost) * 100
      if (!lineInternalCostDec.isZero()) {
        markupPct = markupDec.dividedBy(lineInternalCostDec).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
      }
    } else {
      allSupplierCostsKnown = false;
    }

    normalizedLineItems.push({
      id: item.id || crypto.randomUUID(),
      title: item.title.trim(),
      description: item.description ? item.description.trim() : null,
      category: item.category,
      quantity: item.quantity,
      unitPrice: unitPriceDec.toFixed(2),
      totalPrice: lineTotalDec.toFixed(2),
      supplierCost: normalizedSupplierCost,
      supplierName: item.supplierName ? item.supplierName.trim() : null,
      markupAmount: markupAmountStr,
      marginAmount: marginAmountStr,
      marginPct,
      markupPct,
    });
  }

  // 4. Validate and apply discount
  const discountStr = (input.discountAmount || '0.00').trim();
  if (!DECIMAL_STRING_REGEX.test(discountStr)) {
    throw new Error(`PRICING_VALIDATION_ERROR: Invalid discount amount format "${input.discountAmount}".`);
  }
  const discountDec = new Decimal(discountStr);

  // 5. Validate and apply tax
  const taxStr = (input.taxAmount || '0.00').trim();
  if (!DECIMAL_STRING_REGEX.test(taxStr)) {
    throw new Error(`PRICING_VALIDATION_ERROR: Invalid tax amount format "${input.taxAmount}".`);
  }
  const taxDec = new Decimal(taxStr);

  // 6. Compute grand total
  const grandTotalDec = subtotalDec.minus(discountDec).plus(taxDec);
  if (grandTotalDec.isNegative()) {
    throw new Error(
      `INVALID_DISCOUNT: Discount (${discountDec.toFixed(2)}) exceeds subtotal (${subtotalDec.toFixed(2)}) + tax (${taxDec.toFixed(2)}), resulting in a negative grand total (${grandTotalDec.toFixed(2)}).`
    );
  }

  // 7. Internal cost & Gross Margin Totals
  let finalInternalCostTotalStr: string | null = null;
  let finalGrossMarginAmountStr: string | null = null;

  if (allSupplierCostsKnown) {
    const grossMarginDec = grandTotalDec.minus(internalCostTotalDec);
    finalInternalCostTotalStr = internalCostTotalDec.toFixed(2);
    finalGrossMarginAmountStr = grossMarginDec.toFixed(2); // Can be negative if below-cost!
  }

  // 8. Validate PostgreSQL numeric(12, 2) bounds
  const checkBounds = (val: Decimal, name: string) => {
    if (val.greaterThan(MAX_NUMERIC_12_2) || val.lessThan(MIN_NUMERIC_12_2)) {
      throw new Error(
        `NUMERIC_OVERFLOW: Calculated ${name} (${val.toFixed(2)}) exceeds maximum database numeric(12,2) range [${MIN_NUMERIC_12_2.toFixed(2)}..${MAX_NUMERIC_12_2.toFixed(2)}].`
      );
    }
  };

  checkBounds(subtotalDec, 'subtotal');
  checkBounds(discountDec, 'discount_amount');
  checkBounds(taxDec, 'tax_amount');
  checkBounds(grandTotalDec, 'grand_total');

  if (allSupplierCostsKnown) {
    checkBounds(internalCostTotalDec, 'internal_cost_total');
    checkBounds(new Decimal(finalGrossMarginAmountStr!), 'gross_margin_amount');
  }

  return {
    normalizedLineItems,
    subtotal: subtotalDec.toFixed(2),
    discountAmount: discountDec.toFixed(2),
    taxAmount: taxDec.toFixed(2),
    grandTotal: grandTotalDec.toFixed(2),
    internalCostTotal: finalInternalCostTotalStr,
    grossMarginAmount: finalGrossMarginAmountStr,
  };
}
