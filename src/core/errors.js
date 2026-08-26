export class MineHiveError extends Error {
  constructor(message, { code = 'MINEHIVE_ERROR', details, cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, details: this.details };
  }
}

export class ValidationError extends MineHiveError {
  constructor(message, details) { super(message, { code: 'VALIDATION_ERROR', details }); }
}

export class NotFoundError extends MineHiveError {
  constructor(resource, id) { super(`${resource} '${id}' was not found`, { code: 'NOT_FOUND', details: { resource, id } }); }
}

export class ConflictError extends MineHiveError {
  constructor(message, details) { super(message, { code: 'CONFLICT', details }); }
}

export class InvalidTransitionError extends MineHiveError {
  constructor(from, event) { super(`No transition for '${event}' from '${from}'`, { code: 'INVALID_TRANSITION', details: { from, event } }); }
}

export class TimeoutError extends MineHiveError {
  constructor(operation, timeoutMs) { super(`'${operation}' timed out after ${timeoutMs}ms`, { code: 'TIMEOUT', details: { operation, timeoutMs } }); }
}

export class CancelledError extends MineHiveError {
  constructor(reason = 'Operation cancelled') { super(reason, { code: 'CANCELLED' }); }
}
