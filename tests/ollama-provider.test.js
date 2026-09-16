import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmGateway } from '../src/ai/llm-gateway.js';

test('Ollama provider uses the local native chat endpoint without an API key', async () => {
  const previous = globalThis.fetch; let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ message: { content: JSON.stringify({ intent: 'converse', selector: 'auto', block: null, item: null, count: 1, player: null, x: null, y: null, z: null, home: null, crop: null, mode: null, name: null, type: null, radius: 16, replant: true, reply: 'siap' }) } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const gateway = new LlmGateway({ provider: 'ollama', ollamaEndpoint: 'http://127.0.0.1:11434', ollamaModel: 'qwen3:1.7b', timeoutMs: 5000 }, { warn() {} });
    const result = await gateway.interpret('apa kabar');
    assert.equal(gateway.status().provider, 'ollama');
    assert.equal(result.reply, 'siap');
    assert.equal(request.url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(JSON.parse(request.options.body).stream, false);
  } finally { globalThis.fetch = previous; }
});
