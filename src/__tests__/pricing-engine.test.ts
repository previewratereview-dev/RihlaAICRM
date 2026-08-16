import { describe, it, expect } from 'vitest';
import { calculateQuotePricing, CalculatePricingInput } from '../lib/quotes-itineraries/pricing';

describe('AI-5B.2 Pure Deterministic Pricing Engine', () => {
  it('calculates single line item pricing with exact normalization', () => {
    const input: CalculatePricingInput = {
      lineItems: [
        {
          title: 'Dubai Luxury Hotel',
          category: 'accommodation',
          quantity: 3,
          unitPrice: '15000', // Un-normalized integer string
          supplierCost: '12000.5', // Un-normalized single decimal place
        },
      ],
    };

    const result = calculateQuotePricing(input);

    expect(result.subtotal).toBe('45000.00');
    expect(result.discountAmount).toBe('0.00');
    expect(result.taxAmount).toBe('0.00');
    expect(result.grandTotal).toBe('45000.00');
    expect(result.internalCostTotal).toBe('36001.50');
    expect(result.grossMarginAmount).toBe('8998.50');

    expect(result.normalizedLineItems).toHaveLength(1);
    expect(result.normalizedLineItems[0].unitPrice).toBe('15000.00');
    expect(result.normalizedLineItems[0].totalPrice).toBe('45000.00');
    expect(result.normalizedLineItems[0].supplierCost).toBe('12000.50');
    expect(result.normalizedLineItems[0].markupAmount).toBe('8998.50');
    expect(result.normalizedLineItems[0].marginPct).toBe(20); // 8998.50 / 45000.00 = 0.199966... -> 20.00
  });

  it('correctly handles classic JS floating-point traps (e.g. 0.10 * 3 and 0.1 + 0.2)', () => {
    const input: CalculatePricingInput = {
      lineItems: [
        {
          title: 'Item A',
          category: 'other',
          quantity: 3,
          unitPrice: '0.10', // In JS 0.1 * 3 = 0.30000000000000004
          supplierCost: '0.05',
        },
        {
          title: 'Item B',
          category: 'other',
          quantity: 1,
          unitPrice: '0.20', // 0.30 + 0.20 = 0.50
          supplierCost: '0.10',
        },
      ],
    };

    const result = calculateQuotePricing(input);
    expect(result.normalizedLineItems[0].totalPrice).toBe('0.30');
    expect(result.normalizedLineItems[1].totalPrice).toBe('0.20');
    expect(result.subtotal).toBe('0.50');
    expect(result.grandTotal).toBe('0.50');
    expect(result.internalCostTotal).toBe('0.25');
    expect(result.grossMarginAmount).toBe('0.25');
  });

  it('calculates complex multi-item quote with discount and tax', () => {
    const input: CalculatePricingInput = {
      lineItems: [
        {
          title: 'Flight Ticket',
          category: 'flight',
          quantity: 2,
          unitPrice: '25000.00',
          supplierCost: '22000.00',
        },
        {
          title: 'Resort 4 Nights',
          category: 'accommodation',
          quantity: 1,
          unitPrice: '60000.00',
          supplierCost: '48000.00',
        },
        {
          title: 'Desert Safari',
          category: 'activity',
          quantity: 2,
          unitPrice: '4500.00',
          supplierCost: '3000.00',
        },
      ],
      discountAmount: '5000.00',
      taxAmount: '9360.00', // 8% on discounted subtotal
    };

    // Subtotal: 50000 + 60000 + 9000 = 119000.00
    // Discount: 5000.00
    // Tax: 9360.00
    // Grand Total: 119000 - 5000 + 9360 = 123360.00
    // Internal Cost Total: 44000 + 48000 + 6000 = 98000.00
    // Gross Margin Amount: 123360 - 98000 = 25360.00
    const result = calculateQuotePricing(input);

    expect(result.subtotal).toBe('119000.00');
    expect(result.discountAmount).toBe('5000.00');
    expect(result.taxAmount).toBe('9360.00');
    expect(result.grandTotal).toBe('123360.00');
    expect(result.internalCostTotal).toBe('98000.00');
    expect(result.grossMarginAmount).toBe('25360.00');
  });

  it('correctly reports below-cost quote with negative gross margin amount', () => {
    const input: CalculatePricingInput = {
      lineItems: [
        {
          title: 'Promotional Package',
          category: 'other',
          quantity: 1,
          unitPrice: '10000.00',
          supplierCost: '15000.00', // Supplier cost higher than sale price
        },
      ],
      discountAmount: '2000.00',
      taxAmount: '0.00',
    };

    // Subtotal: 10000.00, Grand Total: 8000.00
    // Internal Cost: 15000.00
    // Margin: 8000 - 15000 = -7000.00
    const result = calculateQuotePricing(input);

    expect(result.subtotal).toBe('10000.00');
    expect(result.grandTotal).toBe('8000.00');
    expect(result.internalCostTotal).toBe('15000.00');
    expect(result.grossMarginAmount).toBe('-7000.00');
  });

  it('treats unknown supplier costs truth-preserving: returns null for internalCostTotal and grossMarginAmount', () => {
    const input: CalculatePricingInput = {
      lineItems: [
        {
          title: 'Hotel',
          category: 'accommodation',
          quantity: 1,
          unitPrice: '20000.00',
          supplierCost: '16000.00',
        },
        {
          title: 'Transfer',
          category: 'transfer',
          quantity: 1,
          unitPrice: '3000.00',
          supplierCost: null, // Unknown supplier cost!
        },
      ],
    };

    const result = calculateQuotePricing(input);

    expect(result.subtotal).toBe('23000.00');
    expect(result.grandTotal).toBe('23000.00');
    expect(result.internalCostTotal).toBeNull();
    expect(result.grossMarginAmount).toBeNull();
    expect(result.normalizedLineItems[0].supplierCost).toBe('16000.00');
    expect(result.normalizedLineItems[1].supplierCost).toBeNull();
  });

  it('allows 100% discount resulting in 0.00 grand total', () => {
    const input: CalculatePricingInput = {
      lineItems: [
        {
          title: 'Complimentary Upgrade',
          category: 'accommodation',
          quantity: 1,
          unitPrice: '5000.00',
          supplierCost: '3000.00',
        },
      ],
      discountAmount: '5000.00',
      taxAmount: '0.00',
    };

    const result = calculateQuotePricing(input);
    expect(result.subtotal).toBe('5000.00');
    expect(result.grandTotal).toBe('0.00');
    expect(result.internalCostTotal).toBe('3000.00');
    expect(result.grossMarginAmount).toBe('-3000.00');
  });

  it('rejects invalid discount that exceeds subtotal + tax', () => {
    const input: CalculatePricingInput = {
      lineItems: [
        {
          title: 'Excursion',
          category: 'activity',
          quantity: 1,
          unitPrice: '1000.00',
        },
      ],
      discountAmount: '1500.00', // Greater than subtotal
      taxAmount: '0.00',
    };

    expect(() => calculateQuotePricing(input)).toThrow(/INVALID_DISCOUNT/);
  });

  it('rejects zero or negative quantity', () => {
    expect(() =>
      calculateQuotePricing({
        lineItems: [
          {
            title: 'Bad Quantity',
            category: 'other',
            quantity: 0,
            unitPrice: '100.00',
          },
        ],
      })
    ).toThrow(/positive integer quantity/);

    expect(() =>
      calculateQuotePricing({
        lineItems: [
          {
            title: 'Negative Quantity',
            category: 'other',
            quantity: -2,
            unitPrice: '100.00',
          },
        ],
      })
    ).toThrow(/positive integer quantity/);
  });

  it('rejects fractional quantity', () => {
    expect(() =>
      calculateQuotePricing({
        lineItems: [
          {
            title: 'Fractional Quantity',
            category: 'other',
            quantity: 1.5,
            unitPrice: '100.00',
          },
        ],
      })
    ).toThrow(/positive integer quantity/);
  });

  it('rejects invalid monetary formats (NaN, scientific notation, negative numbers)', () => {
    expect(() =>
      calculateQuotePricing({
        lineItems: [
          {
            title: 'Negative Price',
            category: 'other',
            quantity: 1,
            unitPrice: '-100.00',
          },
        ],
      })
    ).toThrow(/invalid unit price format/);

    expect(() =>
      calculateQuotePricing({
        lineItems: [
          {
            title: 'Scientific Notation',
            category: 'other',
            quantity: 1,
            unitPrice: '1e5',
          },
        ],
      })
    ).toThrow(/invalid unit price format/);

    expect(() =>
      calculateQuotePricing({
        lineItems: [
          {
            title: 'Invalid Decimals',
            category: 'other',
            quantity: 1,
            unitPrice: '10.555', // 3 decimal places
          },
        ],
      })
    ).toThrow(/invalid unit price format/);
  });

  it('rejects values exceeding database numeric(12, 2) maximum bounds', () => {
    expect(() =>
      calculateQuotePricing({
        lineItems: [
          {
            title: 'Huge Amount',
            category: 'other',
            quantity: 10,
            unitPrice: '2000000000.00', // 10 * 2 billion = 20 billion > 9999999999.99
          },
        ],
      })
    ).toThrow(/NUMERIC_OVERFLOW/);
  });
});
