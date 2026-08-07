const ENTITY_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#96;',
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const REVERSE_ENTITY_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(ENTITY_MAP).map(([k, v]) => [v, k])
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ENTITY_REGEX = /(&amp;|&lt;|&gt;|&quot;|&#x27;|&#x2F;|&#96;|<[^>]*>)/g;

/**
 * Escape HTML special characters to prevent XSS when inserting into DOM.
 * Use this when rendering user-provided strings as innerHTML or in dangerouslySetInnerHTML.
 */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"'`/]/g, (char) => ENTITY_MAP[char] || char);
}

/**
 * Strip HTML tags from a string. Useful for sanitizing user input before storage.
 */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

/**
 * Sanitize a string by escaping HTML and trimming whitespace.
 * Returns empty string for non-string inputs.
 */
export function sanitize(input: unknown): string {
  if (typeof input !== 'string') return '';
  return escapeHtml(input.trim());
}

/**
 * Sanitize an object's string values recursively.
 * Non-string values are passed through unchanged.
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    const val = result[key];
    if (typeof val === 'string') {
      (result as Record<string, unknown>)[key] = sanitize(val);
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      (result as Record<string, unknown>)[key] = sanitizeObject(val as Record<string, unknown>);
    }
  }
  return result;
}

/**
 * Validate and sanitize a URL. Only allows http/https protocols.
 * Returns null if the URL is invalid or uses a disallowed protocol.
 */
export function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Truncate a string to a maximum length, appending ellipsis if truncated.
 */
export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return input.slice(0, maxLength - 1) + '\u2026';
}
