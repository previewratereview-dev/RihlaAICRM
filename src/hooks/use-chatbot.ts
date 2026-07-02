'use client';

import { useState, useCallback, useEffect } from 'react';
import { faqEngine } from '@/lib/chatbot/faq-engine';

export interface ChatMessageUI {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  quickReplies?: string[];
}

export function useChatbot() {
  const [messages, setMessages] = useState<ChatMessageUI[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "Hi! I'm your travel assistant. Ask me about bookings, pricing, destinations, or anything else!",
      timestamp: new Date().toISOString(),
      quickReplies: ['How do I book?', 'What payment methods?', 'Best time for Maldives?'],
    },
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/faq')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.faqs) && data.faqs.length > 0) {
          faqEngine.setDatabaseEntries(data.faqs);
        }
      })
      .catch(() => {});
  }, []);

  const sendMessage = useCallback(async (userMessage: string) => {
    const userMsg: ChatMessageUI = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);
    setError(null);

    try {
      const faqResponse = faqEngine.getResponse(userMessage);

      let assistantContent: string;
      const quickReplies: string[] | undefined = faqResponse.quickReplies;
      let escalate = faqResponse.escalate;

      if (faqResponse.escalate) {
        try {
          const res = await fetch('/api/ai/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: `You are a travel assistant. Answer briefly: "${userMessage}"`,
              feature: 'chatbot_fallback',
              maxTokens: 150,
            }),
          });
          const data = await res.json();
          assistantContent = data.content || faqResponse.answer;
          escalate = true;
        } catch {
          assistantContent = faqResponse.answer;
        }
      } else {
        assistantContent = faqResponse.answer;
      }

      const assistantMsg: ChatMessageUI = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date().toISOString(),
        quickReplies,
      };

      setMessages((prev) => [...prev, assistantMsg]);

      if (escalate) {
        setTimeout(() => {
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now() + 2}`,
              role: 'system',
              content: 'This question has been flagged for a specialist. They will respond shortly.',
              timestamp: new Date().toISOString(),
            },
          ]);
        }, 800);
      }
    } catch {
      setError('Failed to get response. Please try again.');
    } finally {
      setIsTyping(false);
    }
  }, []);

  const resetConversation = useCallback(() => {
    faqEngine.resetContext();
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: "Hi! I'm your travel assistant. Ask me about bookings, pricing, destinations, or anything else!",
        timestamp: new Date().toISOString(),
        quickReplies: ['How do I book?', 'What payment methods?', 'Best time for Maldives?'],
      },
    ]);
  }, []);

  return { messages, isTyping, error, sendMessage, resetConversation };
}
