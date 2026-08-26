const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function redact(value) {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    /password|secret|token|api.?key/i.test(key) ? [key, '[REDACTED]'] : [key, redact(item)]));
}

export class Logger {
  constructor({ level = 'info', service = 'minehive', sink = console } = {}) {
    this.level = level;
    this.service = service;
    this.sink = sink;
  }

  child(metadata = {}) {
    const logger = new Logger({ level: this.level, service: metadata.service ?? this.service, sink: this.sink });
    logger.context = { ...this.context, ...metadata };
    return logger;
  }

  log(level, event, metadata = {}) {
    if ((LEVELS[level] ?? 100) < (LEVELS[this.level] ?? 20)) return;
    const record = redact({ level, timestamp: new Date().toISOString(), service: this.service, event, ...this.context, metadata });
    const writer = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    this.sink[writer](JSON.stringify(record));
  }

  debug(event, metadata) { this.log('debug', event, metadata); }
  info(event, metadata) { this.log('info', event, metadata); }
  warn(event, metadata) { this.log('warn', event, metadata); }
  error(event, metadata) { this.log('error', event, metadata); }
}
