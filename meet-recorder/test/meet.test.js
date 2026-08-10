// Meet URL and DOM detection. These decide whether the banner appears at all,
// so a wrong answer here is silent: no banner, no recording, no error.

import test from 'node:test';
import assert from 'node:assert/strict';

const { callCodeFromUrl, isCallUrl, detectInCall, IN_CALL_SELECTORS, CALL_ENDED_SELECTORS } =
  await import('../lib/meet.js');

test('a call URL yields its code, whatever else is on the URL', () => {
  assert.equal(callCodeFromUrl('https://meet.google.com/abc-defg-hij'), 'abc-defg-hij');
  assert.equal(callCodeFromUrl('https://meet.google.com/abc-defg-hij?authuser=1'), 'abc-defg-hij');
  assert.equal(callCodeFromUrl('https://meet.google.com/abc-defg-hij#pin'), 'abc-defg-hij');
  assert.equal(callCodeFromUrl('https://meet.google.com/ABC-DEFG-HIJ'), 'abc-defg-hij');
});

test('everything that is not a call is not a call', () => {
  assert.equal(callCodeFromUrl('https://meet.google.com/'), null);
  assert.equal(callCodeFromUrl('https://meet.google.com/landing'), null);
  assert.equal(callCodeFromUrl('https://meet.google.com/lookup/abcdefghij'), null);
  assert.equal(callCodeFromUrl('https://meet.google.com/new'), null);
  assert.equal(callCodeFromUrl('https://calendar.google.com/abc-defg-hij'), null);
  assert.equal(callCodeFromUrl('https://evil.example/meet.google.com/abc-defg-hij'), null);
  assert.equal(callCodeFromUrl('not a url'), null);
  assert.equal(callCodeFromUrl(undefined), null);
});

test('isCallUrl is the predicate form of the same judgement', () => {
  assert.equal(isCallUrl('https://meet.google.com/abc-defg-hij'), true);
  assert.equal(isCallUrl('https://meet.google.com/landing'), false);
});

test('detectInCall reports which selector convinced it', () => {
  const found = IN_CALL_SELECTORS[1];
  const root = { querySelector: (sel) => (sel === found ? {} : null) };
  assert.deepEqual(detectInCall(root), { inCall: true, ended: false, matchedBy: found });
});

test('the ended marker wins over any in-call marker', () => {
  // Both present at once means the page is mid-transition. Ended must win:
  // treating it as live is what kept recordings running after the call.
  const root = { querySelector: (sel) => (sel === CALL_ENDED_SELECTORS[0] || sel === IN_CALL_SELECTORS[0] ? {} : null) };
  const result = detectInCall(root);
  assert.equal(result.ended, true);
  assert.equal(result.inCall, false);
});

test('recognising nothing is its own answer, distinct from "not in a call"', () => {
  // The caller needs to tell "Meet changed its markup" from "the call ended".
  // Collapsing the two is what made a finished call look like a live one.
  const root = { querySelector: () => null };
  assert.deepEqual(detectInCall(root), { inCall: false, ended: false, matchedBy: null });
});
