import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, dedupeKeyFor, normalizeJob, applyJobFilter } from '../server/services/jobSources/normalize.js';
import * as manualSource from '../server/services/jobSources/manualSource.js';
import { listSources, getSource, fetchFromSource, registerSource } from '../server/services/jobSources/index.js';

test('htmlToText strips tags and collapses whitespace', () => {
  const html = '<div><script>x()</script><p>Senior&nbsp;Engineer</p><ul><li>Go</li><li>k8s</li></ul></div>';
  const text = htmlToText(html);
  assert.ok(!/[<>]/.test(text), 'no angle brackets remain');
  assert.ok(text.includes('Senior Engineer'));
  assert.ok(text.includes('Go'));
  assert.ok(text.includes('k8s'));
});

test('dedupeKeyFor prefers sourceUrl and is stable', () => {
  const a = dedupeKeyFor({ source: 'greenhouse', sourceUrl: 'https://x/1', text: 'aaa' });
  const b = dedupeKeyFor({ source: 'greenhouse', sourceUrl: 'https://x/1', text: 'bbb' });
  assert.equal(a, b, 'same url => same key regardless of text');
  const c = dedupeKeyFor({ source: 'manual', text: 'aaa' });
  const d = dedupeKeyFor({ source: 'manual', text: 'aaa' });
  assert.equal(c, d, 'no url => key derived from source+text is stable');
  assert.notEqual(a, c);
});

test('normalizeJob fills defaults and computes dedupeKey', () => {
  const job = normalizeJob({ title: 'X', text: '  hello  ', source: 'lever', sourceUrl: 'https://y/2' });
  assert.equal(job.title, 'X');
  assert.equal(job.company, null);
  assert.equal(job.source, 'lever');
  assert.equal(job.text, 'hello', 'text is trimmed');
  assert.ok(job.dedupeKey.length === 40, 'sha1 hex dedupeKey');
});

test('registry exposes built-in and real ATS sources', () => {
  const ids = listSources();
  for (const id of ['manual', 'url', 'greenhouse', 'lever']) {
    assert.ok(ids.includes(id), `registry contains ${id}`);
    assert.equal(typeof getSource(id).fetchJobs, 'function');
  }
});

test('manual source normalizes pasted items and drops empty text', async () => {
  const jobs = await fetchFromSource('manual', { items: [{ text: 'Real JD', title: 'Eng' }, { text: '   ' }] });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Eng');
  assert.equal(jobs[0].source, 'manual');
});

test('registerSource rejects invalid sources', () => {
  assert.throws(() => registerSource({ id: 'bad' }), /fetchJobs/);
  assert.throws(() => registerSource({ fetchJobs() {} }), /id/);
});

const sampleJobs = [
  normalizeJob({ title: 'Backend Engineer', text: 'Go, gRPC, k8s', location: 'Remote, Germany', source: 'greenhouse', sourceUrl: 'https://x/1' }),
  normalizeJob({ title: 'Engineering Manager', text: 'Lead a team', location: 'San Francisco, CA', source: 'greenhouse', sourceUrl: 'https://x/2' }),
  normalizeJob({ title: 'Data Scientist', text: 'Python, ML, statistics', location: 'Remote, US', source: 'lever', sourceUrl: 'https://x/3' })
];

test('applyJobFilter returns all jobs when no filter given', () => {
  assert.equal(applyJobFilter(sampleJobs, {}).length, 3);
  assert.equal(applyJobFilter(sampleJobs).length, 3);
});

test('applyJobFilter matches keywords against title and text (any mode)', () => {
  const r = applyJobFilter(sampleJobs, { keywords: ['python', 'grpc'] });
  assert.equal(r.length, 2, 'matches Backend (grpc) and Data Scientist (python)');
});

test('applyJobFilter keywordMode all requires every keyword', () => {
  const r = applyJobFilter(sampleJobs, { keywords: ['go', 'k8s'], keywordMode: 'all' });
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Backend Engineer');
});

test('applyJobFilter excludeKeywords drops matches', () => {
  const r = applyJobFilter(sampleJobs, { keywords: ['engineer'], excludeKeywords: ['manager'] });
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Backend Engineer');
});

test('applyJobFilter location matches across location field and accepts comma string', () => {
  const remote = applyJobFilter(sampleJobs, { location: 'remote' });
  assert.equal(remote.length, 2);
  const germany = applyJobFilter(sampleJobs, { location: ['germany', 'san francisco'] });
  assert.equal(germany.length, 2);
});

test('applyJobFilter keeps error markers so caller can report them', () => {
  const withError = [...sampleJobs, { source: 'greenhouse', sourceUrl: 'badco', error: 'boom' }];
  const r = applyJobFilter(withError, { keywords: ['nomatchterm'] });
  assert.equal(r.length, 1);
  assert.equal(r[0].error, 'boom');
});
