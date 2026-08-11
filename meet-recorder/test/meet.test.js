// Meet URL and DOM detection. These decide whether the banner appears at all,
// so a wrong answer here is silent: no banner, no recording, no error.

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  callCodeFromUrl,
  isCallUrl,
  detectInCall,
  detectMuted,
  countParticipants,
  MIC_MUTED_SELECTORS,
  MIC_LIVE_SELECTORS,
  IN_CALL_SELECTORS,
  CALL_ENDED_SELECTORS,
} = await import('../lib/meet.js');

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

test('mute is three-valued, and unknown means keep recording', () => {
  // Meet's mute button does not touch getUserMedia, so without this the
  // extension records you while the room hears nothing. But an unrecognised
  // page must not silently drop your side: a half-audible meeting cannot be
  // fixed afterwards, a muttered aside can.
  const root = (sel) => ({ querySelector: (s) => (s === sel ? {} : null) });
  assert.equal(detectMuted(root(MIC_MUTED_SELECTORS[0])).muted, true);
  assert.equal(detectMuted(root(MIC_LIVE_SELECTORS[0])).muted, false);
  assert.equal(detectMuted(root('[aria-label^="Turn on microphone"]')).muted, true);
  assert.equal(detectMuted(root('[aria-label^="Turn off microphone"]')).muted, false);
  assert.deepEqual(detectMuted({ querySelector: () => null }), { muted: null, matchedBy: null });
});

test('"turn on microphone" means muted, which is the easy one to invert', () => {
  // The label describes what the button will do, not what the mic is doing.
  // Reading it the other way round records exactly the wrong half of a call.
  const offered = (label) => ({
    querySelector: (s) => (s === `[aria-label^="${label}"]` ? {} : null),
  });
  assert.equal(detectMuted(offered('Turn on microphone')).muted, true, 'offered ON => it is off');
  assert.equal(detectMuted(offered('Turn off microphone')).muted, false, 'offered OFF => it is on');
});

test('the selectors carry no tag qualifier, which matched nothing on real Meet', () => {
  // These were `button[aria-label^=...]` and matched nothing: Meet's controls
  // are not always <button>. Requiring a tag is a way to be wrong while looking
  // right, so the shape is pinned here rather than left to a future edit.
  for (const sel of [...MIC_MUTED_SELECTORS, ...MIC_LIVE_SELECTORS]) {
    assert.ok(
      sel.startsWith('[') ,
      `${sel} qualifies an element type; aria-label and data attributes should stand alone`,
    );
  }
});

test('no selector matches on a bare Mute/Unmute prefix', () => {
  // Those were tried and withdrawn. Meet labels the control for muting someone
  // *else* "Mute <name>'s microphone", so a Mute prefix makes any call with a
  // second person in it read as live whatever your own microphone is doing.
  for (const sel of [...MIC_MUTED_SELECTORS, ...MIC_LIVE_SELECTORS]) {
    assert.ok(
      !/\[aria-label\^="(Un)?mute/i.test(sel),
      `${sel} would also match another participant's mute control`,
    );
  }
});

test('the microphone is identified before data-is-muted is believed', () => {
  // The camera carries the same attribute. Camera off, microphone live puts
  // data-is-muted="true" on the page while your side is perfectly fine.
  const attrSelectors = [...MIC_MUTED_SELECTORS, ...MIC_LIVE_SELECTORS].filter((s) =>
    s.includes('data-is-muted'),
  );
  assert.ok(attrSelectors.length > 0);
  for (const sel of attrSelectors) {
    assert.match(sel, /aria-label\*="(microphone|micrófono)" i/);
  }
});

test('a malformed selector cannot take the mute probe down', () => {
  assert.deepEqual(
    detectMuted({
      querySelector: () => {
        throw new Error('bad selector');
      },
    }),
    { muted: null, matchedBy: null },
  );
});

test('participants are counted from tiles, with the source recorded', () => {
  const root = { querySelectorAll: (s) => (s.startsWith('[aria-label^="More options') ? [1, 2, 3] : []) };
  const { count, source } = countParticipants(root);
  assert.equal(count, 3);
  assert.match(source, /More options/);
});

test('no recognisable tiles means no number, not zero', () => {
  // Zero people is impossible in a call you are in, so reporting it would be a
  // lie that reads as data. Null says "did not find out".
  assert.deepEqual(countParticipants({ querySelectorAll: () => [] }), { count: null, source: null });
  assert.equal(
    countParticipants({
      querySelectorAll: () => {
        throw new Error('bad');
      },
    }).count,
    null,
  );
});
