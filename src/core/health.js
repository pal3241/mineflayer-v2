export class HealthManager {
  #checks = new Map();
  register(name, check, { critical = false } = {}) { this.#checks.set(name, { check, critical }); }
  async check() {
    const entries = await Promise.all([...this.#checks].map(async ([name, item]) => {
      try {
        const result = await withHealthTimeout(Promise.resolve().then(() => item.check()), 2_000, name);
        return [name, { ...result, status: result?.status ?? 'HEALTHY', critical: item.critical }];
      } catch (error) { return [name, { status: 'FAILED', critical: item.critical, error: error.message }]; }
    }));
    const checks = Object.fromEntries(entries); const values = Object.values(checks);
    const status = values.some(x => x.critical && x.status === 'FAILED') ? 'UNHEALTHY' : values.some(x => x.status !== 'HEALTHY') ? 'DEGRADED' : 'HEALTHY';
    return { status, timestamp: new Date().toISOString(), checks };
  }
}

export class MetricsManager {
  #counters = new Map();
  #gauges = new Map();
  increment(name, amount = 1) { this.#counters.set(name, (this.#counters.get(name) ?? 0) + amount); }
  gauge(name, value) { this.#gauges.set(name, Number(value)); }
  snapshot() { return { counters: Object.fromEntries(this.#counters), gauges: Object.fromEntries(this.#gauges) }; }
}

function withHealthTimeout(promise, timeoutMs, name) { let timer; const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Health check '${name}' timed out after ${timeoutMs}ms`)), timeoutMs); timer.unref?.(); }); return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)); }
