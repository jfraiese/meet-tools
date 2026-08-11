// The control surface. Starting lives here rather than on the in-page banner
// because opening this popup *is* the gesture Chrome requires before it will
// grant tab capture — a click inside the meeting page is not, which is why the
// banner's Record button was removed rather than debugged.
//
// Everything here reads from the offscreen document through the worker. That
// document is the only thing that knows whether audio is really flowing, so the
// meters and the clock cannot drift from the file that eventually lands.

import { isCallUrl, callCodeFromUrl } from './lib/meet.js';
import { levelFraction, litSegments, formatElapsed, SEGMENTS } from './lib/meter.js';
import { countChunks, readMeta, clearSession } from './db.js';

const POLL_MS = 120;
const HOT_FROM = 0.82;

const panel = document.getElementById('panel');
const stateEl = document.getElementById('state');
const clockEl = document.getElementById('clock');
const subjectEl = document.getElementById('subject');
const metersEl = document.getElementById('meters');
const quietEl = document.getElementById('quiet');
const toggle = document.getElementById('toggle');
const hintEl = document.getElementById('hint');

const segsOf = (host) => {
  const made = Array.from({ length: SEGMENTS }, () => document.createElement('span'));
  made.forEach((s) => {
    s.className = 'seg';
    host.append(s);
  });
  return made;
};
const micLabel = document.getElementById('mic-label');
const micSegs = segsOf(document.getElementById('mic'));
const tabSegs = segsOf(document.getElementById('tab'));

function paint(segs, peak) {
  const lit = litSegments(peak);
  segs.forEach((seg, i) => {
    seg.classList.toggle('on', i < lit);
    seg.classList.toggle('hot', i / SEGMENTS >= HOT_FROM);
  });
  return levelFraction(peak);
}

function show({ state, status, subject = '', action = null, actionLabel = '', hint = '' }) {
  panel.dataset.state = state;
  stateEl.textContent = status;
  subjectEl.textContent = subject;
  // No action means no button. A disabled control with a placeholder label is
  // an invitation that goes nowhere; the sentence above it already explains
  // what to do instead.
  //
  // `disabled` is cleared explicitly, not just left alone: the markup ships it
  // set so the button cannot be pressed during the async setup above, and
  // forgetting to clear it here made every button inert while still looking
  // almost normal — a washed-out control reads as a style, not a fault.
  toggle.hidden = !action;
  toggle.disabled = !action;
  toggle.textContent = actionLabel;
  toggle.onclick = action;
  hintEl.innerHTML = hint;
  hintEl.hidden = !hint;
  // chrome:// pages cannot be opened from a link, only from the extension.
  hintEl.querySelector('#bind')?.addEventListener('click', (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

/** What the meeting is called, without Meet's own suffix. */
const meetingName = (t) =>
  t?.title?.replace(/\s*[-–—]\s*Google Meet\s*$/i, '').trim() || callCodeFromUrl(t?.url ?? '') || '';

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const rec = (await chrome.runtime.sendMessage({ type: 'popup-status' })) ?? { state: 'idle' };
const { micGranted } = await chrome.storage.local.get('micGranted');

// Asked, not assumed. Chrome silently drops a suggested shortcut that collides
// with something else and lets the user rebind it at chrome://extensions/shortcuts,
// so the combination in the manifest is a request, not a fact — printing it
// regardless is how you tell someone to press keys that do nothing.
const binding = (await chrome.commands.getAll().catch(() => []))
  .find((c) => c.name === 'toggle-recording')?.shortcut;

const shortcutHint = binding
  ? `<kbd>${binding}</kbd> works without opening this`
  : '<a href="#" id="bind">Set a keyboard shortcut</a> to start without opening this';

let poll = null;

if (!micGranted) {
  show({
    state: 'setup',
    status: 'Setup unfinished',
    subject: 'Chrome will only ask for the microphone from a real tab.',
    actionLabel: 'Finish setup',
    action: () => chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') }),
  });
} else if (rec.state === 'recording' || rec.state === 'arming') {
  const starting = rec.state === 'arming';
  const name = meetingName(tab);
  show({
    state: rec.state,
    status: starting ? 'Starting' : 'Recording',
    subject: name,
    actionLabel: 'Stop and save',
    action: async () => {
      show({ state: 'stopping', status: 'Saving', subject: 'Writing the file to Downloads.' });
      await chrome.runtime.sendMessage({ type: 'popup-toggle' });
      window.close();
    },
  });

  metersEl.hidden = starting;
  clockEl.hidden = true;

  // One poll drives both the meters and the clock, so they can never disagree
  // about whether a recording is still live.
  const tick = async () => {
    const levels = await chrome.runtime.sendMessage({ type: 'popup-levels' }).catch(() => null);
    if (!levels?.recording) {
      // It ended underneath us — the call dropped, or another surface stopped it.
      clearInterval(poll);
      show({ state: 'idle', status: 'Not recording', subject: 'The recording has ended.' });
      metersEl.hidden = true;
      clockEl.hidden = true;
      return;
    }
    metersEl.hidden = false;
    const mic = paint(micSegs, levels.mic ?? 0);
    const tabLevel = paint(tabSegs, levels.tab ?? 0);
    if (levels.startedAt) {
      clockEl.hidden = false;
      clockEl.textContent = formatElapsed(Date.now() - levels.startedAt);
    }
    stateEl.textContent = 'Recording';
    panel.dataset.state = 'recording';
    micLabel.textContent = levels.muted ? 'You · muted' : 'You';
    micLabel.classList.toggle('muted', Boolean(levels.muted));

    if (levels.participants) {
      subjectEl.textContent = `${name} · ${levels.participants} on the call`;
    }

    // Said rather than implied. An empty meter on both sides is worth
    // interrupting someone about — but not when they muted themselves and
    // nobody happens to be talking, which is an ordinary moment in a meeting.
    const silent = mic === 0 && tabLevel === 0 && !levels.muted;
    quietEl.hidden = !silent;
    quietEl.textContent = silent ? 'No sound on either side right now.' : '';
  };
  await tick();
  poll = setInterval(tick, POLL_MS);
} else if (tab && isCallUrl(tab.url ?? '')) {
  const code = callCodeFromUrl(tab.url);
  show({
    state: 'idle',
    status: 'Ready',
    subject: meetingName(tab) || 'This meeting',
    actionLabel: 'Start recording',
    hint: shortcutHint,
    action: async () => {
      show({ state: 'arming', status: 'Starting', subject: 'Asking Chrome for the tab audio.' });
      await chrome.runtime.sendMessage({ type: 'popup-toggle', tabId: tab.id, callCode: code });
      window.close();
    },
  });
} else {
  show({
    state: 'idle',
    status: 'No meeting here',
    subject: 'Open a Google Meet call in this tab to record it.',
  });
}

addEventListener('unload', () => clearInterval(poll));

// Stored chunks mean a recording that never reached disk. The worker tries to
// save these by itself on startup, so this is the fallback for when that failed
// too — not the normal way recordings arrive.
//
// popup-status reconciles against the offscreen document before answering, so
// this state is the document's truth rather than a stale label.
const chunks = rec.state === 'recording' ? 0 : await countChunks().catch(() => 0);

if (chunks > 0) {
  const meta = await readMeta().catch(() => null);
  document.getElementById('recovery').hidden = false;
  document.getElementById('recovery-note').textContent = meta?.startedAt
    ? `An unsaved recording from ${new Date(meta.startedAt).toLocaleTimeString()} is still in storage.`
    : 'An unsaved recording is still in storage.';

  document.getElementById('recover').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'popup-recover' });
    window.close();
  });

  document.getElementById('discard').addEventListener('click', async () => {
    await clearSession();
    window.close();
  });
}
