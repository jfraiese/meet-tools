// What the level meter shows. The popup exists to answer "is it recording and
// is it hearing both of us", so the meter being readable *is* the feature.

import test from 'node:test';
import assert from 'node:assert/strict';

const { levelFraction, litSegments, formatElapsed, SEGMENTS, FLOOR_DB, CEIL_DB } = await import(
  '../lib/meter.js'
);

test('silence reads as empty, and only silence does', () => {
  assert.equal(levelFraction(0), 0);
  assert.equal(levelFraction(-1), 0);
  assert.equal(levelFraction(NaN), 0);
  // The recorder's silence floor is 0.004 peak; below the meter floor it is
  // empty, and a hair above it is not.
  assert.equal(litSegments(0.0001), 0);
  assert.ok(litSegments(0.01) > 0, 'audible speech must light at least one segment');
});

test('the scale is logarithmic, not linear', () => {
  // The whole point: at 0.05 peak — ordinary speech through the -6 dB headroom
  // the mix is recorded at — a linear meter would show 5% and look broken.
  const fraction = levelFraction(0.05);
  assert.ok(fraction > 0.45, `expected a visible reading, got ${fraction}`);
  assert.ok(fraction < 1);
});

test('a full-scale source fills the meter and cannot overflow it', () => {
  assert.equal(levelFraction(1), 1);
  assert.equal(litSegments(1), SEGMENTS);
  assert.equal(litSegments(4), SEGMENTS, 'clipping must not paint more segments than exist');
});

test('louder always means at least as many segments', () => {
  let previous = -1;
  for (const peak of [0, 0.001, 0.004, 0.01, 0.03, 0.08, 0.2, 0.5, 1]) {
    const lit = litSegments(peak);
    assert.ok(lit >= previous, `${peak} lit ${lit} after ${previous}`);
    previous = lit;
  }
});

test('the band covers what a meeting actually occupies', () => {
  assert.ok(FLOOR_DB < -48, 'the floor must sit below the recorder’s silence floor');
  assert.ok(CEIL_DB <= 0 && CEIL_DB > -12);
});

test('the clock grows an hours field only when there are hours', () => {
  // 00:04:12 for a four-minute meeting reads as a stopwatch nobody asked for.
  assert.equal(formatElapsed(0), '00:00');
  assert.equal(formatElapsed(9_000), '00:09');
  assert.equal(formatElapsed(252_000), '04:12');
  assert.equal(formatElapsed(3_599_000), '59:59');
  assert.equal(formatElapsed(3_600_000), '1:00:00');
  assert.equal(formatElapsed(7_265_000), '2:01:05');
});

test('a clock never runs backwards', () => {
  // Clock skew between the offscreen document's startedAt and this context
  // would otherwise render "-1:59".
  assert.equal(formatElapsed(-5_000), '00:00');
});
