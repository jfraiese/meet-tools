// When the extension may start recording by itself. The cases that matter are
// the ones where it must *not*: the green room, a call you already stopped, a
// recording already running.

import test from 'node:test';
import assert from 'node:assert/strict';

const { shouldAutoStart, callKey, forgetTab } = await import('../lib/auto.js');

const inCall = {
  enabled: true,
  idle: true,
  inCall: true,
  matchedBy: '[data-call-live]',
  callCode: 'abc-defg-hij',
  tabId: 7,
  handled: [],
};

test('joining a call starts a recording', () => {
  assert.equal(shouldAutoStart(inCall), true);
});

test('unset counts as on, explicit false as off', () => {
  assert.equal(shouldAutoStart({ ...inCall, enabled: undefined }), true);
  assert.equal(shouldAutoStart({ ...inCall, enabled: false }), false);
});

test('a call assumed from the URL alone is not enough — that is also the green room', () => {
  assert.equal(shouldAutoStart({ ...inCall, matchedBy: null }), false);
});

test('not in a call, or already recording, does nothing', () => {
  assert.equal(shouldAutoStart({ ...inCall, inCall: false }), false);
  assert.equal(shouldAutoStart({ ...inCall, idle: false }), false);
  assert.equal(shouldAutoStart({ ...inCall, callCode: null }), false);
});

test('a call already recorded once in this tab is not restarted after Stop', () => {
  const handled = [callKey(7, 'abc-defg-hij')];
  assert.equal(shouldAutoStart({ ...inCall, handled }), false);
});

test('the same call in another tab, or another call in this tab, still starts', () => {
  const handled = [callKey(7, 'abc-defg-hij')];
  assert.equal(shouldAutoStart({ ...inCall, handled, tabId: 8 }), true);
  assert.equal(shouldAutoStart({ ...inCall, handled, callCode: 'xyz-wxyz-xyz' }), true);
});

test('leaving the call forgets it, so rejoining records again', () => {
  const handled = forgetTab([callKey(7, 'abc-defg-hij'), callKey(17, 'abc-defg-hij')], 7);
  assert.deepEqual(handled, [callKey(17, 'abc-defg-hij')]);
  assert.equal(shouldAutoStart({ ...inCall, handled }), true);
});
