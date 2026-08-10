// Detection, run against attributes captured from a real Google Meet — one
// snapshot taken during a call, one immediately after leaving it.
//
// This is the test that would have caught the original bug: `data-call-ended`
// was listed as an in-call marker when it in fact appears only *after* the
// call, so a finished meeting read as a live one and recordings never stopped
// by themselves.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const fixturePath = path.join(import.meta.dirname, 'fixtures', 'meet-dom.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const { detectInCall, CALL_ENDED_SELECTORS, IN_CALL_SELECTORS } = await import('../lib/meet.js');

/**
 * The smallest thing detectInCall accepts: something with querySelector. Backed
 * by the captured attributes, so a selector "matches" here exactly when it
 * would have matched the real page.
 */
function domFrom(capture) {
  const present = new Set();
  for (const attr of capture.dataAttrs) {
    const parsed = /^([a-z-]+)="(.*)"$/.exec(attr);
    if (!parsed) continue;
    present.add(parsed[1]);
    present.add(`${parsed[1]}=${parsed[2]}`);
  }
  for (const label of capture.ariaLabels) {
    present.add('aria-label');
    present.add(`aria-label=${label}`);
  }
  return {
    querySelector(selector) {
      const parsed = /\[([a-z-]+)(?:="([^"]*)")?\]/.exec(selector);
      if (!parsed) return null;
      const key = parsed[2] === undefined ? parsed[1] : `${parsed[1]}=${parsed[2]}`;
      return present.has(key) ? {} : null;
    },
  };
}

test('a real call in progress reads as in progress', () => {
  const result = detectInCall(domFrom(fixture['in-call']));
  assert.equal(result.inCall, true);
  assert.equal(result.ended, false);
  assert.ok(result.matchedBy, 'should say which selector convinced it');
});

test('a real call that has ended reads as ended', () => {
  const result = detectInCall(domFrom(fixture.left));
  assert.equal(result.ended, true);
  assert.equal(result.inCall, false);
});

test('no in-call selector survives into the ended page', () => {
  // The failure this guards: a marker that lingers after hangup makes a
  // finished call indistinguishable from a live one, and nothing auto-stops.
  const left = domFrom(fixture.left);
  for (const selector of IN_CALL_SELECTORS) {
    assert.equal(
      left.querySelector(selector),
      null,
      `${selector} is still present after leaving the call, so it cannot mean "in a call"`,
    );
  }
});

test('no ended selector is present during the call', () => {
  const inCall = domFrom(fixture['in-call']);
  for (const selector of CALL_ENDED_SELECTORS) {
    assert.equal(
      inCall.querySelector(selector),
      null,
      `${selector} is present during a live call, so it cannot mean "ended"`,
    );
  }
});

test('data-in-call is never used, because it is set in both states', () => {
  // It reads like the obvious signal and is a trap: the capture shows
  // data-in-call="true" both during the call and after it ended.
  const all = [...CALL_ENDED_SELECTORS, ...IN_CALL_SELECTORS].join(' ');
  assert.doesNotMatch(all, /data-in-call/);
  assert.ok(fixture['in-call'].dataAttrs.includes('data-in-call="true"'));
  assert.ok(fixture.left.dataAttrs.includes('data-in-call="true"'));
});

test('detection still covers a non-English Meet', () => {
  assert.ok(IN_CALL_SELECTORS.some((s) => /Salir|Abandonar/.test(s)));
  assert.ok(
    IN_CALL_SELECTORS.some((s) => !/aria-label/.test(s)),
    'at least one selector must be structural, not label-based',
  );
});
