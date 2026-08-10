// idle ──toggle──▶ arming ──started──▶ recording ──toggle/call-ended/tab-closed──▶ stopping ──stopped──▶ idle
//
// Anything not named here is inert. That is deliberate: the service worker is
// restarted at Chrome's discretion, so events arrive in orders no user
// produced, and the machine must shrug rather than throw.

export const IDLE = 'idle';
export const ARMING = 'arming';
export const RECORDING = 'recording';
export const STOPPING = 'stopping';

const STOP = { state: STOPPING, effect: 'stop' };
const DONE = { state: IDLE, effect: null };
const stay = (state) => ({ state, effect: null });

const TABLE = {
  [IDLE]: {
    toggle: { state: ARMING, effect: 'start' },
  },
  [ARMING]: {
    started: { state: RECORDING, effect: null },
    'call-ended': STOP,
    'tab-closed': STOP,
    error: DONE,
  },
  [RECORDING]: {
    toggle: STOP,
    'call-ended': STOP,
    'tab-closed': STOP,
    error: DONE,
  },
  [STOPPING]: {
    stopped: DONE,
    error: DONE,
  },
};

export function next(state, event) {
  return TABLE[state]?.[event] ?? stay(state);
}
