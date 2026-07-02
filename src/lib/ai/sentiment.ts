export type MessageSentiment = 'positive' | 'neutral' | 'negative' | 'urgent';

export function analyzeMessageSentiment(text: string): { sentiment: MessageSentiment; intent: string } {
  const lower = text.toLowerCase();
  let sentiment: MessageSentiment = 'neutral';
  let intent = 'general';

  if (/urgent|asap|immediately|today|emergency|hurry/.test(lower)) {
    sentiment = 'urgent';
    intent = 'urgent_request';
  } else if (/thank|great|perfect|love|excited|yes|book|confirm/.test(lower)) {
    sentiment = 'positive';
    intent = 'positive_engagement';
  } else if (/no|cancel|refund|unhappy|disappointed|expensive|too much|complaint/.test(lower)) {
    sentiment = 'negative';
    intent = 'objection';
  }

  if (/price|cost|budget|how much|quote|fee/.test(lower)) intent = 'pricing';
  if (/book|reserve|deposit|pay|checkout/.test(lower)) intent = 'booking';
  if (/when|date|schedule|meet|call|zoom/.test(lower)) intent = 'scheduling';

  return { sentiment, intent };
}
