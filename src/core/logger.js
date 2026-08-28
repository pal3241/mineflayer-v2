import { ValidationError } from './errors.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function redact(value) {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    /password|secret|token|api.?key/i.test(key) ? [key, '[REDACTED]'] : [key, redact(item)]));
}

export class Logger {
  constructor({ level = 'info', service = 'minehive', sink = console, records = [], store = null } = {}) {
    this.level = level;
    this.service = service;
    this.sink = sink;
    this.records = records;
    this.store = store;
  }

  child(metadata = {}) {
    const logger = new Logger({ level: this.level, service: metadata.service ?? this.service, sink: this.sink, records: this.records, store: this.store });
    logger.context = { ...this.context, ...metadata };
    return logger;
  }

  log(level, event, metadata = {}) {
    if ((LEVELS[level] ?? 100) < (LEVELS[this.level] ?? 20)) return;
    const record = redact({ level, timestamp: new Date().toISOString(), service: this.service, event, ...this.context, metadata });
    this.records.push(record); if (this.records.length > 500) this.records.shift();
    this.store?.write(record);
    const writer = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    this.sink[writer](JSON.stringify(record));
  }

  debug(event, metadata) { this.log('debug', event, metadata); }
  info(event, metadata) { this.log('info', event, metadata); }
  warn(event, metadata) { this.log('warn', event, metadata); }
  error(event, metadata) { this.log('error', event, metadata); }
  setLevel(level) { if (!(level in LEVELS)) throw new ValidationError(`Unsupported log level '${level}'`); this.level = level; return this.status(); }
  status() { return { level: this.level, bufferedRecords: this.records.length }; }
  recent(limit) { const amount = Number(limit); if (!Number.isInteger(amount) || amount < 1 || amount > 500) throw new ValidationError('Log limit must be an integer between 1 and 500'); return this.records.slice(-amount).map(record => structuredClone(record)); }
}
