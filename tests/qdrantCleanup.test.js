import test from 'node:test';
import assert from 'node:assert/strict';

test('Qdrant namespace cleanup deletes points through an exact namespace filter', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      async json() {
        return { result: {} };
      },
      async text() {
        return '';
      }
    };
  };
  try {
    const qdrant = await import(`../server/services/vectorStore.qdrant.js?cleanup=${Date.now()}`);
    const result = await qdrant.deleteVectorNamespace('resume:abc:kb:v1');
    assert.equal(result.deleted, true);
    const deletion = calls.find((item) => item.url.includes('/points/delete'));
    assert.ok(deletion);
    assert.equal(deletion.options.method, 'POST');
    assert.deepEqual(JSON.parse(deletion.options.body).filter, {
      must: [{ key: 'namespace', match: { value: 'resume:abc:kb:v1' } }]
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
