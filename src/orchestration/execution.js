import { TimeoutError } from '../core/errors.js';
import { CancellationToken } from './cancellation.js';

export async function withTimeout(operation, timeoutMs, { name = 'operation', signal } = {}) {
  if (!timeoutMs || timeoutMs < 1) return operation(signal);
  const timeoutController = new AbortController();
  const token = CancellationToken.linked(signal, timeoutController.signal);
  let timer;
  try {
    return await Promise.race([
      operation(token.signal),
      new Promise((_, reject) => { timer = setTimeout(() => { const error = new TimeoutError(name, timeoutMs); timeoutController.abort(error); reject(error); }, timeoutMs); })
    ]);
  } catch (error) {
    if (error?.name === 'AbortError' && error.cause instanceof Error) throw error.cause;
    throw error;
  } finally { clearTimeout(timer); }
}

export async function retry(operation, { attempts = 1, delayMs = 0, signal, shouldRetry = () => true, onRetry } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw signal.reason;
    try { return await operation(attempt); }
    catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) throw error;
      await onRetry?.(error, attempt);
      if (delayMs) await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
    }
  }
  throw lastError;
}
