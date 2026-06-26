import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'resumepilot-sched-')), 'app-db.json');
process.env.APP_DB_FILE = dbFile;
process.env.APP_DB_PROVIDER = 'json';

const { registerSource } = await import('../server/services/jobSources/index.js');
const { runOnce } = await import('../server/services/jobScheduler.js');
const db = await import('../server/services/database.js');

let callCount = 0;
registerSource({
  id: 'test-stub',
  async fetchJobs() {
    callCount += 1;
    return [
      { title: 'Job A', source: 'test-stub', sourceUrl: 'https://stub/a', text: 'AAA', dedupeKey: 'stub-a' },
      { title: 'Job B', source: 'test-stub', sourceUrl: 'https://stub/b', text: 'BBB', dedupeKey: 'stub-b' }
    ];
  }
});

registerSource({
  id: 'test-failing',
  async fetchJobs() { throw new Error('boom'); }
});

test('runOnce saves fetched jobs and dedupes across repeated runs', async () => {
  const cfg = [{ source: 'test-stub', config: {} }];
  const r1 = await runOnce(cfg);
  assert.equal(r1.saved, 2);
  assert.equal(r1.errors.length, 0);

  const r2 = await runOnce(cfg);
  assert.equal(r2.saved, 2, 'reports per-fetch saves');

  const stubJobs = (await db.listJobDescriptions()).filter((j) => j.source === 'test-stub');
  assert.equal(stubJobs.length, 2, 'dedupeKey keeps DB at two rows after two runs');
  assert.equal(callCount, 2, 'source fetched once per run');
});

test('runOnce records source errors without aborting other sources', async () => {
  const summary = await runOnce([
    { source: 'test-failing', config: {} },
    { source: 'test-stub', config: {} }
  ]);
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.errors[0].source, 'test-failing');
  assert.ok(summary.saved >= 2, 'healthy source still saved despite sibling failure');
});
