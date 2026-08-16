'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getTenantAttentionAction } from '@/app/actions/attention';
import type { AttentionSignal, TenantAttentionSummary } from '@/lib/attention/types';

export interface UseAttentionReturn {
  summary: TenantAttentionSummary | null;
  signals: AttentionSignal[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getSignalsForInquiry: (inquiryId: string) => AttentionSignal[];
  getSignalsForConversation: (conversationId: string) => AttentionSignal[];
}

export function useAttention(): UseAttentionReturn {
  const [summary, setSummary] = useState<TenantAttentionSummary | null>(null);
  const [signals, setSignals] = useState<AttentionSignal[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      try {
        const result = await getTenantAttentionAction();
        if (isCancelled) return;
        if (result.success && result.summary && result.signals) {
          setSummary(result.summary);
          setSignals(result.signals);
          setError(null);
        } else {
          setError(result.error || 'Failed to load attention data');
          setSummary(null);
          setSignals([]);
        }
      } catch (err: unknown) {
        if (isCancelled) return;
        const message = err instanceof Error ? err.message : 'Network error loading attention data';
        setError(message);
        setSummary(null);
        setSignals([]);
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      isCancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getTenantAttentionAction();
      if (result.success && result.summary && result.signals) {
        setSummary(result.summary);
        setSignals(result.signals);
      } else {
        setError(result.error || 'Failed to load attention data');
        setSummary(null);
        setSignals([]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error loading attention data';
      setError(message);
      setSummary(null);
      setSignals([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Index signals by Inquiry ID (matches entityId OR inquiryId for linked conversation signals)
  const signalsByInquiry = useMemo(() => {
    const map = new Map<string, AttentionSignal[]>();
    for (const signal of signals) {
      if (signal.entityType === 'inquiry') {
        const list = map.get(signal.entityId) || [];
        list.push(signal);
        map.set(signal.entityId, list);
      } else if (signal.inquiryId) {
        const list = map.get(signal.inquiryId) || [];
        list.push(signal);
        map.set(signal.inquiryId, list);
      }
    }
    return map;
  }, [signals]);

  // Index signals by Conversation ID
  const signalsByConversation = useMemo(() => {
    const map = new Map<string, AttentionSignal[]>();
    for (const signal of signals) {
      if (signal.entityType === 'conversation') {
        const list = map.get(signal.entityId) || [];
        list.push(signal);
        map.set(signal.entityId, list);
      }
    }
    return map;
  }, [signals]);

  const getSignalsForInquiry = useCallback(
    (inquiryId: string): AttentionSignal[] => {
      return signalsByInquiry.get(inquiryId) || [];
    },
    [signalsByInquiry]
  );

  const getSignalsForConversation = useCallback(
    (conversationId: string): AttentionSignal[] => {
      return signalsByConversation.get(conversationId) || [];
    },
    [signalsByConversation]
  );

  return {
    summary,
    signals,
    isLoading,
    error,
    refresh,
    getSignalsForInquiry,
    getSignalsForConversation,
  };
}
