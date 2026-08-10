// The recording state machine. Its whole job is to make the awkward moments
// boring: two shortcut presses in a row, a tab closing while capture is still
// starting, an error arriving after a stop.

import test from 'node:test';
import assert from 'node:assert/strict';

const { next, IDLE, ARMING, RECORDING, STOPPING } = await import('../lib/state.js');

test('the shortcut arms a recording, and the offscreen doc confirms it', () => {
  assert.deepEqual(next(IDLE, 'toggle'), { state: ARMING, effect: 'start' });
  assert.deepEqual(next(ARMING, 'started'), { state: RECORDING, effect: null });
});

test('the shortcut pressed again stops it', () => {
  assert.deepEqual(next(RECORDING, 'toggle'), { state: STOPPING, effect: 'stop' });
  assert.deepEqual(next(STOPPING, 'stopped'), { state: IDLE, effect: null });
});

test('a second press while still arming does not start a second recording', () => {
  assert.deepEqual(next(ARMING, 'toggle'), { state: ARMING, effect: null });
});

test('a press while already stopping is ignored', () => {
  assert.deepEqual(next(STOPPING, 'toggle'), { state: STOPPING, effect: null });
});

test('the call ending or the tab closing stops a recording exactly once', () => {
  assert.deepEqual(next(RECORDING, 'call-ended'), { state: STOPPING, effect: 'stop' });
  assert.deepEqual(next(RECORDING, 'tab-closed'), { state: STOPPING, effect: 'stop' });
  assert.deepEqual(next(STOPPING, 'call-ended'), { state: STOPPING, effect: null });
});

test('a call ending while nothing is recording changes nothing', () => {
  assert.deepEqual(next(IDLE, 'call-ended'), { state: IDLE, effect: null });
  assert.deepEqual(next(IDLE, 'tab-closed'), { state: IDLE, effect: null });
});

test('the tab closing mid-arm still tries to save what exists', () => {
  assert.deepEqual(next(ARMING, 'tab-closed'), { state: STOPPING, effect: 'stop' });
});

test('an error always lands back at idle', () => {
  assert.deepEqual(next(ARMING, 'error'), { state: IDLE, effect: null });
  assert.deepEqual(next(RECORDING, 'error'), { state: IDLE, effect: null });
  assert.deepEqual(next(STOPPING, 'error'), { state: IDLE, effect: null });
});

test('an unknown event is inert rather than fatal', () => {
  assert.deepEqual(next(RECORDING, 'nonsense'), { state: RECORDING, effect: null });
});
