import { isCallUrl, callCodeFromUrl } from './lib/meet.js';
import { countChunks, readMeta, clearSession } from './db.js';

const stateEl = document.getElementById('state');
const sourcesEl = document.getElementById('sources');
const micEl = document.getElementById('mic');
const tabEl = document.getElementById('tab');
const toggle = document.getElementById('toggle');

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const rec = (await chrome.runtime.sendMessage({ type: 'popup-status' })) ?? { state: 'idle' };
const { micGranted } = await chrome.storage.local.get('micGranted');
const { levels } = await chrome.storage.session.get('levels');

const label = (status) => (status === 'silent' ? 'silent' : status === 'active' ? 'ok' : '—');

if (!micGranted) {
  stateEl.textContent = 'Setup not finished';
  toggle.textContent = 'Open setup';
  toggle.disabled = false;
  toggle.addEventListener('click', () =>
    chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') }),
  );
} else if (rec.state === 'recording' || rec.state === 'arming') {
  stateEl.textContent = rec.state === 'arming' ? 'Starting…' : 'Recording';
  sourcesEl.hidden = false;
  micEl.textContent = `You: ${label(levels?.mic)}`;
  micEl.className = levels?.mic === 'silent' ? 'silent' : '';
  tabEl.textContent = `Them: ${label(levels?.tab)}`;
  tabEl.className = levels?.tab === 'silent' ? 'silent' : '';
  toggle.textContent = 'Stop and save';
  toggle.disabled = false;
  toggle.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'popup-toggle' });
    window.close();
  });
} else if (tab && isCallUrl(tab.url ?? '')) {
  stateEl.textContent = 'Ready to record';
  toggle.textContent = 'Start recording';
  toggle.disabled = false;
  toggle.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({
      type: 'popup-toggle',
      tabId: tab.id,
      callCode: callCodeFromUrl(tab.url),
    });
    window.close();
  });
} else {
  stateEl.textContent = 'No Meet in this tab';
  toggle.textContent = 'Nothing to record';
}

// Stored chunks mean a recording that never reached disk. The worker tries to
// save these by itself on startup, so this panel is the fallback for when that
// failed too — not the normal way recordings arrive.
//
// popup-status reconciles against the offscreen document before answering, so
// this state is the document's truth rather than a stale label.
const liveRecording = rec.state === 'recording';
const chunks = liveRecording ? 0 : await countChunks().catch(() => 0);

if (chunks > 0) {
  const meta = await readMeta().catch(() => null);
  const recovery = document.getElementById('recovery');
  recovery.hidden = false;
  document.getElementById('recovery-note').textContent = meta?.startedAt
    ? `An unsaved recording from ${new Date(meta.startedAt).toLocaleTimeString()} is in storage.`
    : 'An unsaved recording is in storage.';

  document.getElementById('recover').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'popup-recover' });
    window.close();
  });

  document.getElementById('discard').addEventListener('click', async () => {
    await clearSession();
    window.close();
  });
}
