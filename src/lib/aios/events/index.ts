/**
 * StateAI AI Operating System (AIOS) — Event Bus
 * 
 * Asynchronous, decoupled Pub/Sub Event Bus for AIOS.
 * Observability, audit logging, metrics, telemetry, and analytics subscribe here.
 * Prevents tight coupling between execution engine and monitoring subsystems.
 */

export type AIOSEventType =
  | 'provider.started'
  | 'provider.finished'
  | 'provider.failed'
  | 'inference.started'
  | 'inference.completed'
  | 'inference.failed'
  | 'circuit.tripped'
  | 'circuit.reset'
  | 'tool.executed'
  | 'tool.failed'
  | 'plan.started'
  | 'plan.finished'
  | 'memory.updated'
  | 'automation.started'
  | 'workflow.failed'
  | 'policy.evaluated'
  | 'policy.denied'
  | 'kernel.started'
  | 'kernel.completed';

export interface AIOSEvent<T = Record<string, unknown>> {
  readonly id: string;
  readonly type: AIOSEventType | string;
  readonly timestamp: Date;
  readonly traceId: string;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly payload: T;
}

export type EventCallback<T = Record<string, unknown>> = (event: AIOSEvent<T>) => void | Promise<void>;
export type EventUnsubscribe = () => void;

export interface EventBus {
  subscribe<T = Record<string, unknown>>(type: AIOSEventType | string | '*', callback: EventCallback<T>): EventUnsubscribe;
  publish<T = Record<string, unknown>>(type: AIOSEventType | string, payload: T, metadata?: { traceId?: string; tenantId?: string; userId?: string }): Promise<void>;
  clearSubscribers(type?: string): void;
}

export class DefaultEventBus implements EventBus {
  private subscribers: Map<string, Set<EventCallback<any>>> = new Map();

  subscribe<T = Record<string, unknown>>(type: AIOSEventType | string | '*', callback: EventCallback<T>): EventUnsubscribe {
    if (!this.subscribers.has(type)) {
      this.subscribers.set(type, new Set());
    }
    const handlers = this.subscribers.get(type)!;
    handlers.add(callback as EventCallback<any>);

    return () => {
      handlers.delete(callback as EventCallback<any>);
      if (handlers.size === 0) {
        this.subscribers.delete(type);
      }
    };
  }

  async publish<T = Record<string, unknown>>(
    type: AIOSEventType | string,
    payload: T,
    metadata?: { traceId?: string; tenantId?: string; userId?: string }
  ): Promise<void> {
    const event: AIOSEvent<T> = {
      id: `evt_${Math.random().toString(36).substring(2, 11)}`,
      type,
      timestamp: new Date(),
      traceId: metadata?.traceId || `trace_${Math.random().toString(36).substring(2, 11)}`,
      tenantId: metadata?.tenantId,
      userId: metadata?.userId,
      payload,
    };

    const specificHandlers = this.subscribers.get(type) || new Set();
    const wildcardHandlers = this.subscribers.get('*') || new Set();
    const allHandlers = new Set([...specificHandlers, ...wildcardHandlers]);

    if (allHandlers.size === 0) return;

    // Execute handlers asynchronously without blocking the publisher
    const executionPromises = Array.from(allHandlers).map(async (handler) => {
      try {
        await handler(event);
      } catch (err) {
        console.error(`[AIOS EventBus Error] Handler failed for event '${type}':`, err);
      }
    });

    await Promise.all(executionPromises);
  }

  clearSubscribers(type?: string): void {
    if (type) {
      this.subscribers.delete(type);
    } else {
      this.subscribers.clear();
    }
  }
}

export const defaultEventBus = new DefaultEventBus();
