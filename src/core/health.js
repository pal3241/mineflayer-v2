export class HealthManager {
  #checks = new Map();
  register(name, check, { critical = false } = {}) { this.#checks.set(name, { check, critical }); }
  async check() {
    const checks = {};
    for (const [name, item] of this.#checks) {
      try { checks[name] = { status: (await item.check())?.status ?? 'HEALTHY', critical: item.critical }; }
      catch (error) { checks[name] = { status: 'FAILED', critical: item.critical, error: error.message }; }
    }
    const values = Object.values(checks);
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
