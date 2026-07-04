/**
 * StateAI AI Operating System (AIOS) — JSON Repair Helper
 * 
 * Repairs malformed or incomplete JSON strings returned by LLMs
 * (e.g., trailing commas, missing closing brackets/braces, markdown code fences).
 */

/**
 * Strips markdown code fences (e.g. ```json ... ```) from an LLM response string.
 */
export function stripMarkdownFences(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();

  // Match ```json ... ``` or ``` ... ```
  const fenceRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
  const match = cleaned.match(fenceRegex);
  if (match && match[1]) {
    return match[1].trim();
  }

  // If there's an opening fence but missing closing fence (truncated)
  if (cleaned.startsWith('```')) {
    const firstNewLine = cleaned.indexOf('\n');
    if (firstNewLine !== -1) {
      cleaned = cleaned.slice(firstNewLine + 1);
    } else {
      cleaned = cleaned.replace(/^```(?:json)?/i, '');
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
  }

  return cleaned.trim();
}

/**
 * Attempts to repair common JSON syntax errors in LLM outputs.
 */
export function repairJson(text: string): string {
  let cleaned = stripMarkdownFences(text);

  if (!cleaned) return '{}';

  // 1. Remove trailing commas before closing brackets/braces
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

  // 2. Try parsing immediately; if valid, return
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // Proceed to repair attempts
  }

  // 3. Balance missing closing brackets or braces (common in truncated outputs)
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') openBraces++;
      else if (char === '}') openBraces = Math.max(0, openBraces - 1);
      else if (char === '[') openBrackets++;
      else if (char === ']') openBrackets = Math.max(0, openBrackets - 1);
    }
  }

  // If we ended inside a string, close the quote
  if (inString) {
    cleaned += '"';
  }

  // Remove trailing comma again if closing string created one
  cleaned = cleaned.replace(/,\s*$/g, '');

  // Close unclosed brackets and braces in reverse order
  while (openBrackets > 0) {
    cleaned += ']';
    openBrackets--;
  }
  while (openBraces > 0) {
    cleaned += '}';
    openBraces--;
  }

  // Final validation attempt
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // If still failing, return original cleaned string so parser can throw descriptive error
    return cleaned;
  }
}

/**
 * Safely parses a JSON string, attempting repair if initial parse fails.
 */
export function safeParseJson<T = unknown>(text: string, fallback?: T): T {
  try {
    const cleaned = stripMarkdownFences(text);
    return JSON.parse(cleaned) as T;
  } catch {
    try {
      const repaired = repairJson(text);
      return JSON.parse(repaired) as T;
    } catch (err) {
      if (fallback !== undefined) {
        return fallback;
      }
      throw err;
    }
  }
}
