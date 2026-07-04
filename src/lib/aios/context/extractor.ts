/**
 * StateAI AI Operating System (AIOS) — Entity Extraction Engine
 * 
 * Automatically harvests business entities (customer, hotel, booking, company,
 * destination, invoice, employee) from conversation text and tool result payloads,
 * storing them separately from raw text to power the Knowledge & Relationship Graph.
 */

import type { ExtractedEntity, ExtractedEntityType } from './types';

export class EntityExtractor {
  private entityStore: Map<string, ExtractedEntity[]> = new Map(); // Keyed by traceId or tenantId

  /**
   * Extract structured entities from natural language conversation text.
   */
  async extractFromText(text: string, source = 'conversation', traceId = 'global'): Promise<ExtractedEntity[]> {
    const extracted: ExtractedEntity[] = [];
    const timestamp = new Date();

    // 1. Email / Customer detection
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = emailRegex.exec(text)) !== null) {
      extracted.push({
        id: `ent_cust_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: 'customer',
        value: match[1],
        confidence: 0.95,
        source,
        timestamp,
        attributes: { email: match[1] },
      });
    }

    // 2. Booking Reference / Invoice detection (e.g., #12345 or BOOK-999 or INV-2026)
    const bookingRegex = /\b(?:booking|reservation|invoice|order|ref|inv)\b\s*#?\s*([A-Z0-9-]{4,12})/gi;
    while ((match = bookingRegex.exec(text)) !== null) {
      const val = match[1].toUpperCase();
      const type: ExtractedEntityType = val.startsWith('INV') ? 'invoice' : 'booking';
      extracted.push({
        id: `ent_${type}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type,
        value: val,
        confidence: 0.88,
        source,
        timestamp,
        attributes: { reference: val },
      });
    }

    // 3. Hotel / Company / Destination keywords
    const hotelRegex = /(?:at|staying at|book|reserved|hotel)\s+([A-Z][a-zA-Z0-9\s&']+(?:Hotel|Resort|Suites|Palace|Inn|Lodge|Motel))/g;
    while ((match = hotelRegex.exec(text)) !== null) {
      extracted.push({
        id: `ent_hotel_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: 'hotel',
        value: match[1].trim(),
        confidence: 0.85,
        source,
        timestamp,
        attributes: { name: match[1].trim() },
      });
    }

    const companyRegex = /\b([A-Z][a-zA-Z0-9&']+(?:\s+[A-Z][a-zA-Z0-9&']+)*\s+(?:Inc\.?|Corp\.?|LLC|Ltd\.?|Group|Enterprises|Technologies|Solutions|Company|Co\.?))\b/g;
    while ((match = companyRegex.exec(text)) !== null) {
      extracted.push({
        id: `ent_comp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: 'company',
        value: match[1].trim(),
        confidence: 0.82,
        source,
        timestamp,
        attributes: { companyName: match[1].trim() },
      });
    }

    this.saveEntities(traceId, extracted);
    return extracted;
  }

  /**
   * Extract structured entities from deterministic tool execution result payloads.
   */
  async extractFromToolResult(toolId: string, resultData: unknown, traceId = 'global'): Promise<ExtractedEntity[]> {
    const extracted: ExtractedEntity[] = [];
    const timestamp = new Date();

    if (resultData && typeof resultData === 'object') {
      const data = resultData as Record<string, any>;

      // CRM Lead / Customer
      if (data.leadId || data.email || data.name) {
        extracted.push({
          id: `ent_cust_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          type: 'customer',
          value: data.name || data.email || data.leadId,
          confidence: 1.0, // 100% confidence from deterministic tool output
          source: `tool:${toolId}`,
          timestamp,
          attributes: { ...data },
        });
      }

      // Travel Booking
      if (data.bookingReference || data.bookingId || data.flightNumber) {
        extracted.push({
          id: `ent_book_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          type: 'booking',
          value: data.bookingReference || data.bookingId || data.flightNumber,
          confidence: 1.0,
          source: `tool:${toolId}`,
          timestamp,
          attributes: { ...data },
        });
      }

      // Hotel
      if (data.hotelName || data.roomType) {
        extracted.push({
          id: `ent_hotel_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          type: 'hotel',
          value: data.hotelName || 'Hotel Room',
          confidence: 1.0,
          source: `tool:${toolId}`,
          timestamp,
          attributes: { ...data },
        });
      }
    }

    this.saveEntities(traceId, extracted);
    return extracted;
  }

  private saveEntities(traceId: string, entities: ExtractedEntity[]): void {
    if (entities.length === 0) return;
    const current = this.entityStore.get(traceId) || [];
    this.entityStore.set(traceId, [...current, ...entities]);
  }

  getEntities(traceId: string): ExtractedEntity[] {
    return this.entityStore.get(traceId) || [];
  }

  clearEntities(traceId: string): void {
    this.entityStore.delete(traceId);
  }
}

export const defaultEntityExtractor = new EntityExtractor();
