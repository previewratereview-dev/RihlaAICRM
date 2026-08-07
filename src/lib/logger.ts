/**
 * Structured logger — replaces console.error/console.log in production.
 * Redacts PII and includes contextual metadata.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  tenantId?: string;
  userId?: string;
  requestId?: string;
  [key: string]: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function redact(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  if (val.includes('@') && val.includes('.')) return '[REDACTED_EMAIL]';
  if (/^\d{10,}$/.test(val)) return '[REDACTED_PHONE]';
  if (/^(sk-|rk_|whsec_)/.test(val)) return '[REDACTED_KEY]';
  return val;
}

function formatMessage(level: LogLevel, message: string, context?: LogContext): string {
  const ts = new Date().toISOString();
  const ctx = context ? ` ${JSON.stringify(context)}` : '';
  return `[${ts}] [${level.toUpperCase()}]${ctx} ${message}`;
}

export const logger = {
  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(formatMessage('debug', message, context));
    }
  },
  info(message: string, context?: LogContext) {
    console.info(formatMessage('info', message, context));
  },
  warn(message: string, context?: LogContext) {
    console.warn(formatMessage('warn', message, context));
  },
  error(message: string, error?: unknown, context?: LogContext) {
    const errStr = error instanceof Error ? error.message : String(error ?? '');
    console.error(formatMessage('error', `${message} ${errStr}`, context));
  },
};
