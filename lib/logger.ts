/**
 * lib/logger.ts — Structured logger
 *
 * Outputs JSON lines in production (easy to ingest in Datadog / Loki / etc.)
 * and pretty-prints in development.
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   const log = logger.child({ module: 'order-processor', orderId });
 *   log.info('Invoice created', { invoiceId });
 *   log.error('AWB failed', { error: e.message });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogFields = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) ??
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function emit(level: LogLevel, msg: string, fields: LogFields): void {
  if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;

  if (process.env.NODE_ENV === 'production') {
    // JSON lines — one object per line, easy to parse by log aggregators
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...fields,
    });
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  } else {
    // Pretty dev output
    const prefix = `[${level.toUpperCase()}]`;
    const ctx = Object.keys(fields).length
      ? ' ' + JSON.stringify(fields, null, 0)
      : '';
    const fn =
      level === 'error'
        ? console.error
        : level === 'warn'
          ? console.warn
          : console.log;
    fn(`${prefix} ${msg}${ctx}`);
  }
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

function createLogger(baseFields: LogFields = {}): Logger {
  return {
    debug: (msg, fields = {}) => emit('debug', msg, { ...baseFields, ...fields }),
    info:  (msg, fields = {}) => emit('info',  msg, { ...baseFields, ...fields }),
    warn:  (msg, fields = {}) => emit('warn',  msg, { ...baseFields, ...fields }),
    error: (msg, fields = {}) => emit('error', msg, { ...baseFields, ...fields }),
    child: (fields) => createLogger({ ...baseFields, ...fields }),
  };
}

export const logger: Logger = createLogger();
