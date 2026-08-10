// Service worker: the one place that knows whether a recording is happening.
//
// Two things here are not free choices. The stream id must be obtained in a
// handler Chrome considers user-invoked — a `commands` shortcut or an action
// click — and it must be obtained for a specific tab. And the service worker
// is killed at Chrome's discretion, so live state is mirrored into
// chrome.storage.session; a worker that comes back mid-recording must not
// believe it is idle.

import { next, IDLE, RECORDING } from './lib/state.js';
import { isCallUrl, callCodeFromUrl } from './lib/meet.js';
import { countChunks } from './db.js';

const OFFSCREEN_PATH = 'offscreen.html';
const DOWNLOAD_TIMEOUT_MS = 30000;

async function readState() {
  const { rec } = await chrome.storage.session.get('rec');
  return rec ?? { state: IDLE, tabId: null, callCode: null };
}

async function writeState(rec) {
  await chrome.storage.session.set({ rec });
  const recording = rec.state === RECORDING;
  await chrome.action.setBadgeText({ text: recording ? 'REC' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#c5221f' });
}

/**
 * A recording state with nothing actually recording behind it is a lie — the
 * offscreen document was destroyed without its stop path running (reloading
 * the extension mid-call does this), or a save failed. Left alone it wedges
 * the UI into "Recording" forever and the next shortcut does nothing.
 *
 * Asking the document directly, rather than trusting that it exists, is the
 * point: the document outlives a recording, so its mere presence proves
 * nothing.
 */
async function reconcile() {
  const rec = await readState();

  let live = false;
  if (await chrome.offscreen.hasDocument()) {
    const response = await sendToOffscreen({ target: 'offscreen', type: 'ping' }, 3);
    live = Boolean(response?.recording);
  }

  // Sync in both directions. Healing only the stale-recording case left the
  // opposite divergence — a live recording the worker believed was idle —
  // which made the next press try to *start* one, get silently refused, and
  // wedge everything including the stop.
  if (live && rec.state !== RECORDING) {
    const synced = { ...rec, state: RECORDING };
    await writeState(synced);
    return synced;
  }
  if (!live && rec.state !== IDLE) {
    const healed = { ...rec, state: IDLE };
    await writeState(healed);
    return healed;
  }
  return rec;
}

async function tellTab(tabId, message) {
  if (tabId == null) return;
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // The tab is gone, or has no content script. Not an error worth surfacing.
  }
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    // USER_MEDIA, never AUDIO_PLAYBACK: AUDIO_PLAYBACK closes the document
    // after 30s without audio, which would end a recording during a pause.
    reasons: ['USER_MEDIA'],
    justification: 'Merge microphone and tab audio and record the meeting.',
  });
}

/**
 * createDocument() resolves once the document exists, which is before its
 * module script has run and registered a listener. A start message sent in
 * that window is simply dropped, so retry until it is acknowledged.
 */
async function sendToOffscreen(message, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response?.ok) return response;
    } catch {
      // No receiver yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/**
 * Download a blob URL minted by the offscreen document. This lives here, not
 * there, because `chrome.downloads` is not among the APIs an offscreen document
 * may use — only `chrome.runtime` is.
 *
 * Resolves true only when the file reached disk, and always resolves. The
 * listener is registered before the download starts, because a small file can
 * complete before the call returns; the download is then queried directly,
 * because even that is not early enough if completion beat the listener; and a
 * timeout backstops both, because a promise that never settles here would hang
 * the stop path.
 */
function downloadBlobUrl(url, filename) {
  return new Promise((resolve) => {
    let settled = false;
    let downloadId = null;

    const settle = (ok) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      clearTimeout(timer);
      resolve(ok);
    };

    function onChanged(delta) {
      if (downloadId === null || delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete') settle(true);
      if (delta.state.current === 'interrupted') settle(false);
    }

    const timer = setTimeout(async () => {
      if (downloadId === null) return settle(false);
      const [item] = await chrome.downloads.search({ id: downloadId }).catch(() => []);
      settle(item?.state === 'complete');
    }, DOWNLOAD_TIMEOUT_MS);

    chrome.downloads.onChanged.addListener(onChanged);

    chrome.downloads
      .download({ url, filename, saveAs: false })
      .then(async (id) => {
        if (id === undefined) return settle(false);
        downloadId = id;
        const [item] = await chrome.downloads.search({ id }).catch(() => []);
        if (item?.state === 'complete') settle(true);
        if (item?.state === 'interrupted') settle(false);
      })
      .catch(() => settle(false));
  });
}

async function dispatch(event, extra = {}) {
  const rec = await readState();
  const { state, effect } = next(rec.state, event);
  const updated = { ...rec, ...extra, state };
  await writeState(updated);

  if (effect === 'start') await startCapture(updated);
  if (effect === 'stop') await stopCapture(updated, extra.stopReason ?? 'manual');
  return updated;
}

async function startCapture(rec) {
  const { micGranted } = await chrome.storage.local.get('micGranted');
  if (!micGranted) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    await dispatch('error');
    return;
  }

  let tab;
  try {
    tab = await chrome.tabs.get(rec.tabId);
  } catch {
    await dispatch('error');
    return;
  }

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: rec.tabId });
  } catch (err) {
    // Chrome grants tab capture only after the extension itself is invoked —
    // an action click, a context menu item, or the commands shortcut. A click
    // on our own banner is none of those, so say what will work.
    const needsInvoking = /invoke|activeTab/i.test(err.message);
    await tellTab(rec.tabId, {
      type: 'recording-state',
      state: 'idle',
      note: needsInvoking
        ? 'Chrome needs the extension itself first — press the shortcut, or click the toolbar icon once. After that this button works.'
        : `Could not capture this tab: ${err.message}`,
    });
    await dispatch('error');
    return;
  }

  await ensureOffscreen();
  const delivered = await sendToOffscreen({
    target: 'offscreen',
    type: 'start',
    streamId,
    meta: { callCode: rec.callCode, tabTitle: tab.title ?? '', startedAt: Date.now() },
  });

  if (!delivered) {
    await tellTab(rec.tabId, {
      type: 'recording-state',
      state: 'idle',
      note: 'Recording failed to start — the capture page never answered',
    });
    await dispatch('error');
  }
}

async function stopCapture(rec, stopReason) {
  const delivered = await sendToOffscreen({ target: 'offscreen', type: 'stop', stopReason }, 5);
  await tellTab(rec.tabId, { type: 'recording-state', state: 'idle' });
  if (!delivered) {
    // Nothing is listening, so no 'stopped' will ever arrive. Land at idle
    // rather than sit in 'stopping' — whatever was captured is in IndexedDB,
    // and idle is what lets the popup offer it back.
    await dispatch('error');
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const { micGranted } = await chrome.storage.local.get('micGranted');
  if (!micGranted) chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
});

// The shortcut. This handler is what Chrome treats as the user invoking the
// extension, which is what makes getMediaStreamId legal below it.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-recording') return;
  // reconcile, not readState: a stale 'recording' left by a dead document must
  // not swallow the shortcut that is trying to start a new recording.
  const rec = await reconcile();

  if (rec.state === IDLE) {
    if (!tab || !isCallUrl(tab.url ?? '')) {
      await chrome.action.setBadgeText({ text: '?' });
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1200);
      return;
    }
    await dispatch('toggle', { tabId: tab.id, callCode: callCodeFromUrl(tab.url) });
  } else {
    await dispatch('toggle', { stopReason: 'manual' });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'call-state') {
      const rec = await readState();
      if (!msg.inCall && rec.state !== IDLE && rec.tabId === sender.tab?.id) {
        await dispatch('call-ended', { stopReason: 'call-ended' });
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'started') {
      const rec = await dispatch('started');
      await tellTab(rec.tabId, {
        type: 'recording-state',
        state: 'recording',
        note: 'Recording this meeting',
      });
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'stopped') {
      await dispatch('stopped');
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'error') {
      const rec = await readState();
      await tellTab(rec.tabId, {
        type: 'recording-state',
        state: 'idle',
        note: `Recording failed: ${msg.message}`,
      });
      await dispatch('error');
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'levels') {
      const rec = await readState();
      const { levels: previous } = await chrome.storage.session.get('levels');
      await chrome.storage.session.set({ levels: { mic: msg.mic, tab: msg.tab } });

      const nameOf = (l) =>
        l.mic === 'silent' ? 'Your microphone' : l.tab === 'silent' ? 'The meeting audio' : null;
      const dead = nameOf(msg);
      const wasDead = previous ? nameOf(previous) : null;

      // Edge-triggered, and in both directions. This fired on every sample
      // while a side was quiet and nothing ever sent the banner back to
      // 'recording', so the first time a colleague talked for 30 seconds the
      // bar went amber and stayed amber for the rest of the call.
      if (rec.state === RECORDING && dead !== wasDead) {
        await tellTab(
          rec.tabId,
          dead
            ? {
                type: 'recording-state',
                state: 'warn',
                note: `${dead} has been quiet for 30s — fine if nobody is talking, worth a look if not`,
              }
            : { type: 'recording-state', state: 'recording' },
        );
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'popup-status') {
      const healed = await reconcile();
      sendResponse({ ...healed, hasOffscreen: await chrome.offscreen.hasDocument() });
      return;
    }

    // The banner's button. Stopping is always allowed; starting may be refused
    // by Chrome, and startCapture explains that on the banner when it is.
    if (msg?.type === 'banner-start') {
      const rec = await reconcile();
      if (rec.state === IDLE && sender.tab && isCallUrl(sender.tab.url ?? '')) {
        await dispatch('toggle', {
          tabId: sender.tab.id,
          callCode: callCodeFromUrl(sender.tab.url),
        });
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'banner-stop') {
      const rec = await reconcile();
      if (rec.state !== IDLE) await dispatch('toggle', { stopReason: 'manual' });
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'download') {
      try {
        const ok = await downloadBlobUrl(msg.url, msg.filename);
        sendResponse({ ok });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
      return;
    }

    if (msg?.type === 'popup-recover') {
      await ensureOffscreen();
      await sendToOffscreen({ target: 'offscreen', type: 'recover' });
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'saved') {
      const rec = await readState();
      await tellTab(rec.tabId, {
        type: 'recording-state',
        state: 'saved',
        note: `Saved ${msg.filename}`,
      });
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'popup-toggle') {
      const rec = await reconcile();
      if (rec.state === IDLE) {
        await dispatch('toggle', { tabId: msg.tabId, callCode: msg.callCode ?? null });
      } else {
        await dispatch('toggle', { stopReason: 'manual' });
      }
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false });
  })();
  return true; // keep the message channel open for the async work above
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const rec = await readState();
  if (rec.tabId === tabId && rec.state !== IDLE) {
    await dispatch('tab-closed', { stopReason: 'tab-closed' });
  }
});

// On worker startup: heal any stale state, then rescue whatever a previous run
// left behind. Recovery you have to remember to click is recovery that mostly
// does not happen — and the chunks are already on disk, so there is nothing to
// ask about.
(async () => {
  const rec = await reconcile();
  if (rec.state !== IDLE) return;
  const chunks = await countChunks().catch(() => 0);
  if (!chunks) return;
  await ensureOffscreen();
  await sendToOffscreen({ target: 'offscreen', type: 'recover' });
})().catch(() => {});
