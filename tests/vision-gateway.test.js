import test from 'node:test';
import assert from 'node:assert/strict';
import { VisionGateway } from '../src/ai/vision-gateway.js';

const image = 'data:image/png;base64,aGVsbG8=';

test('VLM stays disabled without its own credentials', async () => {
  const gateway = new VisionGateway({ endpoint: 'https://integrate.api.nvidia.com/v1', model: 'test-vlm', apiKeys: [] });
  assert.equal(gateway.status().enabled, false);
  await assert.rejects(gateway.analyze({ image }), /VLM is disabled/);
});

test('VLM uses its own key and sends a multimodal chat request', async t => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'A wooden house is visible.' } }], usage: { total_tokens: 20 } }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const gateway = new VisionGateway({
    endpoint: 'https://integrate.api.nvidia.com/v1/',
    model: 'test-vlm',
    apiKeys: ['VLM_SECRET_ONLY'],
    timeoutMs: 5000
  });
  const result = await gateway.analyze({ image, prompt: 'Describe the base.' });
  assert.equal(result.text, 'A wooden house is visible.');
  assert.equal(request.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(request.options.headers.authorization, 'Bearer VLM_SECRET_ONLY');
  assert.equal(request.body.messages[0].content[1].image_url.url, image);
});

test('VLM rejects remote URLs and malformed image inputs', async () => {
  const gateway = new VisionGateway({ endpoint: 'https://example.com/v1', model: 'test-vlm', apiKeys: ['key'] });
  await assert.rejects(gateway.analyze({ image: 'https://example.com/image.png' }), /base64 data URL/);
});
