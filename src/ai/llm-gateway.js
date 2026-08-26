import { ValidationError } from '../core/errors.js';

const INTENTS = new Set(['collect', 'craft', 'follow', 'move', 'set_home', 'home', 'status']);

export class OpenAICompatibleProvider {
  constructor({ endpoint, apiKey, apiKeys = [], model, structuredOutput = true, headers = {}, timeoutMs = 30_000, rotateOn = [401, 402, 429] }) { this.endpoint = endpoint.replace(/\/$/, ''); this.keys = [...new Set([...apiKeys, apiKey].filter(Boolean))].map(key => ({ key, cooldownUntil: 0 })); this.model = model; this.structuredOutput = structuredOutput; this.headers = headers; this.timeoutMs = timeoutMs; this.rotateOn = new Set(rotateOn); this.keyIndex = 0; }
  async complete(messages, schema) {
    const request = (structured, apiKey) => fetch(`${this.endpoint}/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(this.timeoutMs), headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...this.headers },
      body: JSON.stringify({ model: this.model, messages, temperature: 0, ...(structured ? { response_format: { type: 'json_schema', json_schema: { name: 'minehive_command', strict: true, schema } } } : {}) }) });
    const attempts = Math.max(1, this.keys.length); let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const entry = this.#nextKey(); if (this.keys.length && !entry) throw new Error('All LLM API keys are cooling down after rate limits');
      let response = await request(this.structuredOutput, entry?.key); if (response.status === 400 && this.structuredOutput) { await response.body?.cancel(); response = await request(false, entry?.key); }
      if (response.ok) { const payload = await response.json(); return payload.choices?.[0]?.message?.content ?? ''; }
      const message = `LLM HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`; lastError = new Error(message);
      if (!entry || !this.rotateOn.has(response.status)) throw lastError;
      entry.cooldownUntil = response.status === 429 ? Date.now() + retryDelay(response.headers.get('retry-after')) : Date.now() + 60_000; this.keyIndex = (this.keys.indexOf(entry) + 1) % this.keys.length;
    }
    throw lastError ?? new Error('No LLM API key is available');
  }
  #nextKey() { if (!this.keys.length) return null; for (let offset = 0; offset < this.keys.length; offset++) { const index = (this.keyIndex + offset) % this.keys.length; if (this.keys[index].cooldownUntil <= Date.now()) { this.keyIndex = index; return this.keys[index]; } } return null; }
  status() { return { keyCount: this.keys.length, activeKey: this.keys.length ? this.keyIndex + 1 : null, availableKeys: this.keys.filter(entry => entry.cooldownUntil <= Date.now()).length }; }
}

export class LlmGateway {
  constructor(config, logger) { this.config = config; this.logger = logger; const resolved = buildProvider(config); this.provider = resolved?.provider ?? null; this.providerName = resolved?.name ?? 'disabled'; }
  status() { return { enabled: Boolean(this.provider), provider: this.providerName, model: this.provider?.model ?? null, endpoint: this.provider?.endpoint ?? null, ...(this.provider?.status?.() ?? {}) }; }
  async interpret(text, context = {}) {
    if (!this.provider) return deterministicIntent(text, context.selector);
    const messages = [{ role: 'system', content: 'You coordinate Minecraft bots. The fleet data includes each bot position, inventory, and nearby bots sorted by distance. Return only the requested JSON. Never invent tools. Allowed intents: collect, craft, follow, move, set_home, home, status. selector must be auto, global, bot:<alias>, or class:<name>. Tool borrowing and crafting prerequisites are executed automatically after your intent is validated.' },
      { role: 'user', content: JSON.stringify({ request: text, fleet: context.fleet ?? context.bots, requestedSelector: context.selector ?? 'auto' }) }];
    try { return validateIntent(parseJson(await this.provider.complete(messages, commandSchema)), context.selector); }
    catch (error) { this.logger?.warn('llm.interpretation.fallback', { error: error.message }); return deterministicIntent(text, context.selector); }
  }
}

function buildProvider(config) {
  const openRouterKeys = [...new Set([...(config.apiKeys ?? []), config.apiKey].filter(Boolean))];
  if ((config.provider === 'openrouter' || config.provider === 'auto') && openRouterKeys.length) return { name: 'openrouter', provider: new OpenAICompatibleProvider({ endpoint: config.endpoint || 'https://openrouter.ai/api/v1', apiKeys: openRouterKeys, model: config.model || 'openrouter/auto', structuredOutput: true, headers: { 'HTTP-Referer': config.siteUrl ?? 'http://localhost', 'X-Title': 'MineHive' }, timeoutMs: config.timeoutMs }) };
  const localRequested = config.provider === 'local'; const localReady = (config.localEndpoint || config.endpoint) && config.localModel;
  if ((localRequested || config.provider === 'auto') && localReady) return { name: 'local', provider: new OpenAICompatibleProvider({ endpoint: config.localEndpoint || config.endpoint, apiKey: config.localApiKey, model: config.localModel, structuredOutput: config.localStructuredOutput, timeoutMs: config.timeoutMs }) };
  return null;
}

function parseJson(value) { const match = String(value).match(/\{[\s\S]*\}/); if (!match) throw new ValidationError('LLM did not return JSON'); return JSON.parse(match[0]); }
function validateIntent(value, forcedSelector) {
  if (!INTENTS.has(value.intent)) throw new ValidationError(`Unsupported LLM intent '${value.intent}'`);
  const result = { intent: value.intent, selector: forcedSelector ?? value.selector ?? 'auto', block: value.block?.toLowerCase() ?? undefined, item: value.item?.toLowerCase() ?? undefined, count: normalizeCount(value.count), player: value.player ?? undefined,
    x: numberOrUndefined(value.x), y: numberOrUndefined(value.y), z: numberOrUndefined(value.z), home: value.home ?? 'home' };
  if (!/^(auto|global|bot:[A-Za-z0-9_.-]{1,64}|class:[A-Za-z0-9_.-]{1,64})$/.test(result.selector)) throw new ValidationError('Invalid selector from LLM');
  for (const field of ['block', 'item', 'player', 'home']) if (result[field] !== undefined && !/^[A-Za-z0-9_.-]{1,64}$/.test(result[field])) throw new ValidationError(`Invalid ${field} from LLM`);
  if (result.intent === 'collect' && !result.block) throw new ValidationError('Collect intent requires block');
  if (result.intent === 'craft' && !result.item) throw new ValidationError('Craft intent requires item');
  if (result.intent === 'follow' && !result.player) throw new ValidationError('Follow intent requires player');
  if (result.intent === 'move' && [result.x, result.y, result.z].some(value => value === undefined)) throw new ValidationError('Move intent requires x, y, z');
  return result;
}
function deterministicIntent(text, selector = 'auto') {
  const words = String(text).trim().toLowerCase().split(/\s+/); const countToken = words.find(value => /^\d+$/.test(value)); const count = Math.max(1, Math.min(64, Number(countToken ?? 1)));
  if (words.includes('collect') || words.includes('ambil') || words.includes('kumpulkan')) return validateIntent({ intent: 'collect', selector, block: after(words, ['collect', 'ambil', 'kumpulkan']) ?? 'stone', count }, selector);
  if (words.includes('craft') || words.includes('buat')) return validateIntent({ intent: 'craft', selector, item: after(words, ['craft', 'buat']), count }, selector);
  if (words.includes('follow') || words.includes('ikuti')) return validateIntent({ intent: 'follow', selector, player: after(words, ['follow', 'ikuti']) }, selector);
  if (words.includes('sethome') || words.includes('set_home')) return validateIntent({ intent: 'set_home', selector, home: words.at(-1) === 'sethome' ? 'home' : words.at(-1) }, selector);
  if (words.includes('home') || words.includes('pulang')) return validateIntent({ intent: 'home', selector, home: words.at(-1) === 'pulang' ? 'home' : words.at(-1) }, selector);
  if (words.includes('goto') || words.includes('move')) { const numbers = words.map(Number).filter(Number.isFinite); return validateIntent({ intent: 'move', selector, x: numbers[0], y: numbers[1], z: numbers[2] }, selector); }
  return validateIntent({ intent: 'status', selector }, selector);
}
function after(words, candidates) { const index = words.findIndex(value => candidates.includes(value)); return words.slice(index + 1).find(value => !/^\d+$/.test(value)); }
function normalizeCount(value) { const count = Number.parseInt(value ?? 1, 10); return Number.isFinite(count) ? Math.max(1, Math.min(64, count)) : 1; }
function numberOrUndefined(value) { if (value === null || value === undefined || value === '') return undefined; const number = Number(value); return Number.isFinite(number) ? number : undefined; }
function retryDelay(header) { const seconds = Number(header); if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1000); const date = Date.parse(header); return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : 60_000; }

const commandSchema = { type: 'object', additionalProperties: false, required: ['intent', 'selector', 'block', 'item', 'count', 'player', 'x', 'y', 'z', 'home'], properties: {
  intent: { type: 'string', enum: [...INTENTS] }, selector: { type: 'string' }, block: { type: ['string', 'null'] }, item: { type: ['string', 'null'] }, count: { type: 'integer', minimum: 1, maximum: 64 },
  player: { type: ['string', 'null'] }, x: { type: ['number', 'null'] }, y: { type: ['number', 'null'] }, z: { type: ['number', 'null'] }, home: { type: ['string', 'null'] }
} };
