/**
 * Phase AI-5C.1: Deterministic Quote Difference Engine
 * 
 * Computes exact arithmetic and structural differences between two quote versions.
 * 
 * Invariants:
 * - Deterministic pricing authority: Arithmetic diffs are computed by code, NOT the LLM.
 * - Precision: Decimal calculations are exact to 2 decimal places.
 * - Role-Safe: Internal supplier cost and margin diffs are omitted for unauthorized roles.
 */

import Decimal from 'decimal.js';
import { can } from '@/lib/permissions';
import type { QuoteLineItem } from '@/lib/quotes-itineraries/types';
import type {
  DeterministicQuoteDiff,
  DeterministicLineItemDiff,
  QuoteItemCategory,
} from './contracts';

export interface RawQuoteVersionForDiff {
  quoteId: string;
  quoteNumber: string;
  id: string;
  versionNumber: number;
  currency: string;
  itineraryVersionId?: string | null;
  validUntil?: string | null;
  termsAndConditions?: string | null;
  subtotal: string | number;
  discountAmount: string | number;
  taxAmount: string | number;
  grandTotal: string | number;
  internalCostTotal?: string | number | null;
  grossMarginAmount?: string | number | null;
  lineItems: QuoteLineItem[];
}

function formatDecimal(d: Decimal): string {
  return d.toFixed(2);
}

function diffAmounts(v1: string | number | null | undefined, v2: string | number | null | undefined): string {
  const d1 = new Decimal(v1 != null && v1 !== '' ? String(v1) : '0');
  const d2 = new Decimal(v2 != null && v2 !== '' ? String(v2) : '0');
  return formatDecimal(d2.minus(d1));
}

/**
 * Calculates deterministic diff between Quote Version 1 (base) and Quote Version 2 (target).
 */
export function calculateQuoteDifference(
  v1: RawQuoteVersionForDiff,
  v2: RawQuoteVersionForDiff,
  role: string
): DeterministicQuoteDiff {
  const hasInternalPricing = can(role, 'quotes:internal_pricing:read');

  // Compare grand totals and subtotals
  const subtotalDiff = diffAmounts(v1.subtotal, v2.subtotal);
  const discountDiff = diffAmounts(v1.discountAmount, v2.discountAmount);
  const taxDiff = diffAmounts(v1.taxAmount, v2.taxAmount);
  const grandTotalDiff = diffAmounts(v1.grandTotal, v2.grandTotal);

  // Line item diffs
  const v1Items = v1.lineItems || [];
  const v2Items = v2.lineItems || [];

  const v1Map = new Map<string, QuoteLineItem>();
  const v1TitleMap = new Map<string, QuoteLineItem>();
  for (const item of v1Items) {
    if (item.id) v1Map.set(item.id, item);
    v1TitleMap.set(item.title.toLowerCase().trim(), item);
  }

  const matchedV1Ids = new Set<string>();
  const itemDiffs: DeterministicLineItemDiff[] = [];

  for (const item2 of v2Items) {
    // Try matching by ID first, then title
    let match1: QuoteLineItem | undefined;
    if (item2.id && v1Map.has(item2.id)) {
      match1 = v1Map.get(item2.id);
    } else {
      match1 = v1TitleMap.get(item2.title.toLowerCase().trim());
    }

    if (match1) {
      if (match1.id) matchedV1Ids.add(match1.id);
      const q1 = Number(match1.quantity);
      const q2 = Number(item2.quantity);
      const p1 = new Decimal(match1.unitPrice || '0');
      const p2 = new Decimal(item2.unitPrice || '0');
      const t1 = new Decimal(match1.totalPrice || '0');
      const t2 = new Decimal(item2.totalPrice || '0');

      const isModified = q1 !== q2 || !p1.equals(p2) || match1.title !== item2.title || match1.category !== item2.category;

      let v1SupplierCost: string | null = null;
      let v2SupplierCost: string | null = null;
      let supplierCostDifference: string | null = null;

      if (hasInternalPricing) {
        if (match1.supplierCost != null && match1.supplierCost !== '') {
          v1SupplierCost = formatDecimal(new Decimal(match1.supplierCost));
        }
        if (item2.supplierCost != null && item2.supplierCost !== '') {
          v2SupplierCost = formatDecimal(new Decimal(item2.supplierCost));
        }
        if (v1SupplierCost != null || v2SupplierCost != null) {
          supplierCostDifference = diffAmounts(v1SupplierCost, v2SupplierCost);
        }
      }

      itemDiffs.push({
        itemId: item2.id || match1.id || `item-${itemDiffs.length + 1}`,
        title: item2.title,
        category: item2.category as QuoteItemCategory,
        changeType: isModified ? 'modified' : 'unchanged',
        v1Quantity: q1,
        v2Quantity: q2,
        v1UnitPrice: formatDecimal(p1),
        v2UnitPrice: formatDecimal(p2),
        v1TotalPrice: formatDecimal(t1),
        v2TotalPrice: formatDecimal(t2),
        priceDifference: formatDecimal(t2.minus(t1)),
        v1SupplierCost,
        v2SupplierCost,
        supplierCostDifference,
      });
    } else {
      // Added item
      const t2 = new Decimal(item2.totalPrice || '0');
      let v2SupplierCost: string | null = null;
      let supplierCostDifference: string | null = null;

      if (hasInternalPricing && item2.supplierCost != null && item2.supplierCost !== '') {
        v2SupplierCost = formatDecimal(new Decimal(item2.supplierCost));
        supplierCostDifference = v2SupplierCost;
      }

      itemDiffs.push({
        itemId: item2.id || `added-${itemDiffs.length + 1}`,
        title: item2.title,
        category: item2.category as QuoteItemCategory,
        changeType: 'added',
        v1Quantity: null,
        v2Quantity: Number(item2.quantity),
        v1UnitPrice: null,
        v2UnitPrice: formatDecimal(new Decimal(item2.unitPrice || '0')),
        v1TotalPrice: null,
        v2TotalPrice: formatDecimal(t2),
        priceDifference: formatDecimal(t2),
        v1SupplierCost: null,
        v2SupplierCost,
        supplierCostDifference,
      });
    }
  }

  // Check for removed items from v1
  for (const item1 of v1Items) {
    if (item1.id && !matchedV1Ids.has(item1.id)) {
      const t1 = new Decimal(item1.totalPrice || '0');
      let v1SupplierCost: string | null = null;
      let supplierCostDifference: string | null = null;

      if (hasInternalPricing && item1.supplierCost != null && item1.supplierCost !== '') {
        v1SupplierCost = formatDecimal(new Decimal(item1.supplierCost));
        supplierCostDifference = formatDecimal(new Decimal(item1.supplierCost).negated());
      }

      itemDiffs.push({
        itemId: item1.id,
        title: item1.title,
        category: item1.category as QuoteItemCategory,
        changeType: 'removed',
        v1Quantity: Number(item1.quantity),
        v2Quantity: null,
        v1UnitPrice: formatDecimal(new Decimal(item1.unitPrice || '0')),
        v2UnitPrice: null,
        v1TotalPrice: formatDecimal(t1),
        v2TotalPrice: null,
        priceDifference: formatDecimal(t1.negated()),
        v1SupplierCost,
        v2SupplierCost: null,
        supplierCostDifference,
      });
    }
  }

  const hasItineraryChange = Boolean(v1.itineraryVersionId && v2.itineraryVersionId && v1.itineraryVersionId !== v2.itineraryVersionId);
  const hasValidityChange = (v1.validUntil || null) !== (v2.validUntil || null);
  const hasTermsChange = (v1.termsAndConditions || null) !== (v2.termsAndConditions || null);

  // Internal pricing differences (only if role is authorized)
  let v1InternalCostTotal: string | null = null;
  let v2InternalCostTotal: string | null = null;
  let internalCostDifference: string | null = null;
  let v1GrossMarginAmount: string | null = null;
  let v2GrossMarginAmount: string | null = null;
  let grossMarginDifference: string | null = null;

  if (hasInternalPricing) {
    if (v1.internalCostTotal != null) v1InternalCostTotal = formatDecimal(new Decimal(String(v1.internalCostTotal)));
    if (v2.internalCostTotal != null) v2InternalCostTotal = formatDecimal(new Decimal(String(v2.internalCostTotal)));
    if (v1InternalCostTotal != null && v2InternalCostTotal != null) {
      internalCostDifference = diffAmounts(v1InternalCostTotal, v2InternalCostTotal);
    }

    if (v1.grossMarginAmount != null) v1GrossMarginAmount = formatDecimal(new Decimal(String(v1.grossMarginAmount)));
    if (v2.grossMarginAmount != null) v2GrossMarginAmount = formatDecimal(new Decimal(String(v2.grossMarginAmount)));
    if (v1GrossMarginAmount != null && v2GrossMarginAmount != null) {
      grossMarginDifference = diffAmounts(v1GrossMarginAmount, v2GrossMarginAmount);
    }
  }

  return {
    quoteId: v1.quoteId,
    quoteNumber: v1.quoteNumber,
    v1VersionId: v1.id,
    v1VersionNumber: v1.versionNumber,
    v2VersionId: v2.id,
    v2VersionNumber: v2.versionNumber,
    currency: v1.currency || 'USD',
    v1GrandTotal: formatDecimal(new Decimal(String(v1.grandTotal || '0'))),
    v2GrandTotal: formatDecimal(new Decimal(String(v2.grandTotal || '0'))),
    grandTotalDifference: grandTotalDiff,
    v1Subtotal: formatDecimal(new Decimal(String(v1.subtotal || '0'))),
    v2Subtotal: formatDecimal(new Decimal(String(v2.subtotal || '0'))),
    subtotalDifference: subtotalDiff,
    v1Discount: formatDecimal(new Decimal(String(v1.discountAmount || '0'))),
    v2Discount: formatDecimal(new Decimal(String(v2.discountAmount || '0'))),
    discountDifference: discountDiff,
    v1Tax: formatDecimal(new Decimal(String(v1.taxAmount || '0'))),
    v2Tax: formatDecimal(new Decimal(String(v2.taxAmount || '0'))),
    taxDifference: taxDiff,
    hasItineraryChange,
    v1ItineraryVersionId: v1.itineraryVersionId || null,
    v2ItineraryVersionId: v2.itineraryVersionId || null,
    hasValidityChange,
    v1ValidUntil: v1.validUntil || null,
    v2ValidUntil: v2.validUntil || null,
    hasTermsChange,
    v1TermsAndConditions: v1.termsAndConditions || null,
    v2TermsAndConditions: v2.termsAndConditions || null,
    itemDiffs,
    v1InternalCostTotal,
    v2InternalCostTotal,
    internalCostDifference,
    v1GrossMarginAmount,
    v2GrossMarginAmount,
    grossMarginDifference,
  };
}

/**
 * Strips all internal financial differences to produce a purely customer-safe diff.
 * Used exclusively for generating clientFacingExplanation so LLM never sees internal margins.
 */
export function getCustomerSafeQuoteDiff(diff: DeterministicQuoteDiff): DeterministicQuoteDiff {
  return {
    ...diff,
    itemDiffs: diff.itemDiffs.map((item) => ({
      ...item,
      v1SupplierCost: null,
      v2SupplierCost: null,
      supplierCostDifference: null,
    })),
    v1InternalCostTotal: null,
    v2InternalCostTotal: null,
    internalCostDifference: null,
    v1GrossMarginAmount: null,
    v2GrossMarginAmount: null,
    grossMarginDifference: null,
  };
}
