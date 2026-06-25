import test from 'node:test';
import assert from 'node:assert/strict';

const savedKey = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
process.env.OPENAI_BASE_URL = 'https://gateway.example.com/v1/';
process.env.OPENAI_MODEL = 'test-model';

const { callLLMJson, getLLMConfig } = await import(`../server/services/llmClient.js?t=${Date.now()}`);

test('getLLMConfig reports fallback when no api key and trims trailing slash from base url', () => {
  const config = getLLMConfig();
  assert.equal(config.configured, false);
  assert.equal(config.mode, 'fallback');
  assert.equal(config.model, 'test-model');
  assert.equal(config.baseUrl, 'https://gateway.example.com/v1');
});

test('callLLMJson returns fallback object and mode without api key', async () => {
  const fallbackObject = { feedback: ['default'] };
  const result = await callLLMJson({ system: 's', user: 'u', schemaHint: '{}', fallbackObject });
  assert.equal(result.mode, 'fallback');
  assert.deepEqual(result.object, fallbackObject);
});

test.after(() => {
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
});
