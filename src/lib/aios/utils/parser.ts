/**
 * StateAI AI Operating System (AIOS) — Structured Output Parser
 * 
 * Reusable structured output parser that leverages JSON repair and
 * optional Zod or custom schema validation.
 */

import { safeParseJson } from './json-repair';
import { ParsingError } from '../errors';

export interface SchemaValidator<T> {
  parse(data: unknown): T;
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/**
 * Parses an LLM output string into a structured JSON object, applying repair if needed,
 * and validating against a Zod or custom schema validator.
 */
export function parseStructuredOutput<T>(
  text: string,
  schema?: SchemaValidator<T>,
  provider = 'unknown'
): T {
  let parsed: unknown;
  try {
    parsed = safeParseJson(text);
  } catch (err) {
    throw new ParsingError(provider, `Failed to parse JSON string: ${err instanceof Error ? err.message : String(err)}`, err);
  }

  if (!schema) {
    return parsed as T;
  }

  const validation = schema.safeParse(parsed);
  if (!validation.success) {
    const errorMsg = typeof validation.error === 'object' && validation.error !== null && 'message' in validation.error
      ? String((validation.error as { message?: unknown }).message)
      : String(validation.error);
    throw new ParsingError(provider, `Schema validation failed: ${errorMsg}`, validation.error);
  }

  return validation.data;
}
