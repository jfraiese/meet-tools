// What the automatic transcriber picks up, and above all what it leaves alone.

import test from 'node:test';
import assert from 'node:assert/strict';

const { pendingRecordings, speakersFromSidecar } = await import('../lib/auto.js');

const base = { since: 1000, tried: [], now: 100000, settleMs: 15000 };

test('a recording with its sidecar is ready', () => {
  const r = pendingRecordings({ ...base, names: ['a.webm', 'a.json'], mtimes: { 'a.webm': 99000 } });
  assert.deepEqual(r, { ready: ['a'], waiting: [] });
});

test('a fresh recording without its sidecar waits; a settled one goes', () => {
  const r = pendingRecordings({
    ...base,
    names: ['fresh.webm', 'old-recovered.webm'],
    mtimes: { 'fresh.webm': 95000, 'old-recovered.webm': 50000 },
  });
  assert.deepEqual(r, { ready: ['old-recovered'], waiting: ['fresh'] });
});

test('already transcribed, already tried, or from before install: left alone', () => {
  const r = pendingRecordings({
    ...base,
    tried: ['tried'],
    names: ['done.webm', 'done.json', 'done.txt', 'tried.webm', 'tried.json', 'archive.webm', 'archive.json'],
    mtimes: { 'done.webm': 99000, 'tried.webm': 99000, 'archive.webm': 500 },
  });
  assert.deepEqual(r, { ready: [], waiting: [] });
});

test('transcripts, sidecars and hidden files are not recordings', () => {
  const r = pendingRecordings({
    ...base,
    names: ['a.txt', 'a.srt', 'a.speakers.json', '.a.webm'],
    mtimes: { '.a.webm': 99000 },
  });
  assert.deepEqual(r, { ready: [], waiting: [] });
});

test('the speaker count comes from the sidecar only when it is a real number', () => {
  assert.equal(speakersFromSidecar({ participants: 4 }), 4);
  assert.equal(speakersFromSidecar({ participants: null }), null);
  assert.equal(speakersFromSidecar({ participants: 0 }), null);
  assert.equal(speakersFromSidecar(null), null);
});
