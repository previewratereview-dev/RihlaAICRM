import { z } from 'zod';
import {
  ITINERARY_ITEM_TYPES,
  QUOTE_LINE_CATEGORIES,
  ACCEPTANCE_TYPES,
} from './types';

/**
 * Strict regex for non-negative decimal currency string: e.g. "25000.00", "0.00", "150.5"
 */
export const DECIMAL_STRING_REGEX = /^\d+(\.\d{1,2})?$/;

export const DecimalStringSchema = z
  .string()
  .trim()
  .regex(DECIMAL_STRING_REGEX, {
    message: 'Must be a valid non-negative decimal string (e.g. "15000.00" or "0.00")',
  });

/**
 * Itinerary Item Zod Schema
 */
export const ItineraryItemSchema = z.object({
  id: z.string().uuid().default(() => crypto.randomUUID()),
  itemType: z.enum(ITINERARY_ITEM_TYPES),
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().nullable().optional(),
  location: z.string().trim().nullable().optional(),
  startTime: z.string().trim().nullable().optional(),
  endTime: z.string().trim().nullable().optional(),
  supplierName: z.string().trim().nullable().optional(),
  internalNotes: z.string().trim().nullable().optional(),
});

/**
 * Itinerary Day Zod Schema
 */
export const ItineraryDaySchema = z.object({
  dayNumber: z.number().int().positive('Day number must be a positive integer'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD')
    .nullable()
    .optional(),
  title: z.string().trim().min(1, 'Day title is required'),
  summary: z.string().trim().nullable().optional(),
  items: z.array(ItineraryItemSchema).default([]),
});

export const ItineraryDaysArraySchema = z
  .array(ItineraryDaySchema)
  .refine(
    (days) => {
      // Ensure day numbers are strictly sequential 1..N
      return days.every((d, idx) => d.dayNumber === idx + 1);
    },
    { message: 'Day numbers must be strictly sequential starting from 1' }
  );

/**
 * Editable Line Item Input Schema (Client -> Server)
 */
export const QuoteLineItemInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Line item title is required'),
  description: z.string().trim().nullable().optional(),
  category: z.enum(QUOTE_LINE_CATEGORIES),
  quantity: z.number().int().positive('Quantity must be a positive integer'),
  unitPrice: DecimalStringSchema,
  supplierCost: DecimalStringSchema.nullable().optional(),
  supplierName: z.string().trim().nullable().optional(),
});

export const QuoteLineItemsInputArraySchema = z
  .array(QuoteLineItemInputSchema)
  .min(1, 'Quote must have at least one line item');

/**
 * Customer Quote Acceptance Submission Schema
 */
export const QuoteAcceptanceSubmissionSchema = z.object({
  travelerName: z.string().trim().min(1, 'Traveler name is required'),
  travelerEmail: z.string().trim().email('Valid traveler email is required'),
  acceptanceType: z.enum(ACCEPTANCE_TYPES),
  acceptedGrandTotal: DecimalStringSchema,
  currency: z.string().trim().length(3, 'Currency code must be 3 characters'),
});

/**
 * Lossless Optimistic Concurrency Update Draft Schemas
 */
export const UpdateItineraryDraftInputSchema = z.object({
  versionId: z.string().uuid(),
  expectedLockVersion: z.number().int().nonnegative('Expected lock version must be a non-negative integer'),
  title: z.string().trim().min(1).optional(),
  destinationSummary: z.string().trim().nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  durationDays: z.number().int().positive().nullable().optional(),
  passengerCount: z.number().int().positive().nullable().optional(),
  days: ItineraryDaysArraySchema.optional(),
  inclusions: z.array(z.string().trim()).optional(),
  exclusions: z.array(z.string().trim()).optional(),
});

export const UpdateQuoteDraftInputSchema = z.object({
  versionId: z.string().uuid(),
  expectedLockVersion: z.number().int().nonnegative('Expected lock version must be a non-negative integer'),
  itineraryVersionId: z.string().uuid().optional(),
  currency: z.string().trim().length(3).optional(),
  lineItems: QuoteLineItemsInputArraySchema,
  discountAmount: DecimalStringSchema.optional(),
  taxAmount: DecimalStringSchema.optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  termsAndConditions: z.string().trim().nullable().optional(),
  customerNotes: z.string().trim().nullable().optional(),
});
