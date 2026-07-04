/**
 * StateAI AI Operating System (AIOS) — Telemetry Interface & Adapters
 * 
 * Vendor-neutral observability interface.
 * Swapping telemetry destinations (Console, Supabase, OpenTelemetry, Langfuse, LangSmith)
 * requires zero changes to business logic or AIKernel.
 */

import { defaultEventBus, type AIOSEvent } from '../events';

export interface TelemetryEventPayload {
  name: string;
  traceId: string;
  tenantId?: string;
  userId?: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
}

export interface TelemetryMetricPayload {
  name: string;
  value: number;
  unit: 'ms' | 'tokens' | 'usd' | 'count' | 'percent';
  tags?: Record<string, string>;
  timestamp?: Date;
}

export interface Telemetry {
  logEvent(payload: TelemetryEventPayload): void | Promise<void>;
  logMetric(payload: TelemetryMetricPayload): void | Promise<void>;
  logError(error: unknown, metadata?: { traceId?: string; tenantId?: string; provider?: string }): void | Promise<void>;
  flush(): Promise<void>;
}

export class ConsoleTelemetry implements Telemetry {
  logEvent(payload: TelemetryEventPayload): void {
    if (process.env.NODE_ENV === 'development' || process.env.AIOS_DEBUG === 'true') {
      console.log(`[AIOS Telemetry Event] ${payload.name} (Trace: ${payload.traceId})`, payload.properties || {});
    }
  }

  logMetric(payload: TelemetryMetricPayload): void {
    if (process.env.NODE_ENV === 'development' || process.env.AIOS_DEBUG === 'true') {
      console.log(`[AIOS Telemetry Metric] ${payload.name}: ${payload.value}${payload.unit}`, payload.tags || {});
    }
  }

  logError(error: unknown, metadata?: { traceId?: string; tenantId?: string; provider?: string }): void {
    console.error(`[AIOS Telemetry Error] (Trace: ${metadata?.traceId || 'none'})`, error, metadata || {});
  }

  async flush(): Promise<void> {
    // No-op for console
  }
}

export class CompositeTelemetry implements Telemetry {
  private adapters: Telemetry[] = [];

  constructor(adapters: Telemetry[] = [new ConsoleTelemetry()]) {
    this.adapters = adapters;
    this.bindToEventBus();
  }

  addAdapter(adapter: Telemetry): void {
    this.adapters.push(adapter);
  }

  async logEvent(payload: TelemetryEventPayload): Promise<void> {
    await Promise.all(this.adapters.map(a => Promise.resolve(a.logEvent(payload)).catch(() => {})));
  }

  async logMetric(payload: TelemetryMetricPayload): Promise<void> {
    await Promise.all(this.adapters.map(a => Promise.resolve(a.logMetric(payload)).catch(() => {})));
  }

  async logError(error: unknown, metadata?: { traceId?: string; tenantId?: string; provider?: string }): Promise<void> {
    await Promise.all(this.adapters.map(a => Promise.resolve(a.logError(error, metadata)).catch(() => {})));
  }

  async flush(): Promise<void> {
    await Promise.all(this.adapters.map(a => a.flush().catch(() => {})));
  }

  /**
   * Automatically subscribes Telemetry to the AIOS EventBus.
   */
  private bindToEventBus(): void {
    defaultEventBus.subscribe('*', async (event: AIOSEvent) => {
      await this.logEvent({
        name: event.type,
        traceId: event.traceId,
        tenantId: event.tenantId,
        userId: event.userId,
        properties: event.payload,
        timestamp: event.timestamp,
      });

      // Automatically extract latency or token metrics if present
      if (event.payload && typeof event.payload === 'object') {
        const p = event.payload as Record<string, any>;
        if (typeof p.latencyMs === 'number') {
          await this.logMetric({
            name: `${event.type}.latency`,
            value: p.latencyMs,
            unit: 'ms',
            tags: { provider: String(p.provider || 'unknown'), model: String(p.model || 'unknown') },
          });
        }
        if (p.usage && typeof p.usage === 'object') {
          if (typeof p.usage.totalTokens === 'number') {
            await this.logMetric({
              name: `${event.type}.tokens`,
              value: p.usage.totalTokens,
              unit: 'tokens',
              tags: { provider: String(p.provider || 'unknown'), model: String(p.model || 'unknown') },
            });
          }
          if (typeof p.usage.estimatedCost === 'number') {
            await this.logMetric({
              name: `${event.type}.cost`,
              value: p.usage.estimatedCost,
              unit: 'usd',
              tags: { provider: String(p.provider || 'unknown'), model: String(p.model || 'unknown') },
            });
          }
        }
      }
    });
  }
}

export const defaultTelemetry = new CompositeTelemetry();
