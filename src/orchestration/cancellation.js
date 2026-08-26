import { CancelledError } from '../core/errors.js';

export class CancellationToken {
  #controller;
  constructor(controller = new AbortController()) { this.#controller = controller; }
  get signal() { return this.#controller.signal; }
  get cancelled() { return this.signal.aborted; }
  get reason() { return this.signal.reason; }
  cancel(reason = 'Operation cancelled') { if (!this.cancelled) this.#controller.abort(new CancelledError(reason)); }
  throwIfCancelled() { if (this.cancelled) throw this.reason instanceof Error ? this.reason : new CancelledError(String(this.reason)); }
  static linked(...signals) {
    const token = new CancellationToken();
    for (const signal of signals.filter(Boolean)) {
      if (signal.aborted) token.cancel(signal.reason);
      else signal.addEventListener('abort', () => token.cancel(signal.reason), { once: true });
    }
    return token;
  }
}
