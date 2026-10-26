import { ValidationError } from '../core/errors.js';

/**
 * Dedicated NVIDIA NIM-compatible vision client.
 * Its credentials are intentionally independent from the LLM gateway.
 * Vision is disabled unless endpoint, model, and at least one VLM key exist.
 */
export class VisionGateway {
  constructor(config = {}, logger = null) {
    this.logger = logger;
    this.timeoutMs = boundedTimeout(config.timeoutMs);
    this.configure(config);
  }

  configure(config = {}) {
    const endpoint = clean(config.endpoint);
    const model = clean(config.model);
    const apiKeys = [...new Set((config.apiKeys ?? []).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
    if (endpoint && !/^https:\/\//i.test(endpoint)) throw new ValidationError('VLM endpoint must use HTTPS');
    if (endpoint && !/^https:\/\//i.test(endpoint)) throw new ValidationError('VLM endpoint must use HTTPS');
    this.endpoint = endpoint?.replace(/\/$/, '') ?? null;
    this.model = model ?? null;
    this.keys = apiKeys.map(key => ({ key, cooldownUntil: 0 }));
    this.keyIndex = 0;
    return this.status();
  }

  status() {
    return {
      enabled: Boolean(this.endpoint && this.model && this.keys.length),
      provider: 'nvidia-nim-vlm',
      model: this.model,
      endpoint: this.endpoint,
      keyCount: this.keys.length,
      availableKeys: this.keys.filter(entry => entry.cooldownUntil <= Date.now()).length
    };
  }

  async analyze({ image, prompt = 'Describe the visible Minecraft scene and distinguish observed facts from uncertain inferences.' } = {}) {
    if (!this.status().enabled) throw new ValidationError('VLM is disabled: configure a VLM endpoint, model, and separate VLM API key');
    if (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) {
      throw new ValidationError('VLM image must be a base64 data URL for PNG, JPEG, or WebP');
    }
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) throw new ValidationError('VLM prompt must contain 1–4000 characters');

    const attempts = this.keys.length;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const entry = this.#nextKey();
      if (!entry) throw new Error('All VLM API keys are cooling down');
      const response = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${entry.key}` },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 512,
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt.trim() },
            { type: 'image_url', image_url: { url: image } }
          ] }]
        })
      });
      if (response.ok) {
        const payload = await response.json();
        return { model: this.model, text: payload.choices?.[0]?.message?.content ?? '', usage: payload.usage ?? null };
      }
      const status = response.status;
      lastError = new Error(`VLM HTTP ${status}: ${(await response.text()).slice(0, 250)}`);
      if (![401, 402, 429].includes(status)) throw lastError;
      entry.cooldownUntil = Date.now() + (status === 429 ? retryDelay(response.headers.get('retry-after')) : 60_000);
      this.keyIndex = (this.keys.indexOf(entry) + 1) % this.keys.length;
    }
    this.logger?.warn?.('vlm.request.failed', { error: lastError?.message });
    throw lastError ?? new Error('No VLM API key is available');
  }

  #nextKey() {
    for (let offset = 0; offset < this.keys.length; offset++) {
      const index = (this.keyIndex + offset) % this.keys.length;
      if (this.keys[index].cooldownUntil <= Date.now()) {
        this.keyIndex = index;
        return this.keys[index];
      }
    }
    return null;
  }
}

function clean(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/[\r\n]/.test(value) || value.length > 500) throw new ValidationError('VLM setting is invalid');
  return value.trim();
}
function boundedTimeout(value) {
  const timeout = Number(value ?? 30_000);
  if (!Number.isInteger(timeout) || timeout < 5_000 || timeout > 300_000) throw new ValidationError('VLM timeout must be between 5000 and 300000 ms');
  return timeout;
}
function retryDelay(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(1000, Math.min(120_000, seconds * 1000)) : 30_000;
}
