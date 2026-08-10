// Injected on meet.google.com. Two jobs: notice when you are actually in a
// call, and offer the banner that starts and stops recording.
//
// The banner's button does work, but it is not guaranteed: Chrome grants tab
// capture only once the extension itself has been invoked, and a click inside
// the page does not count as that gesture. So the first press of a session can
// be refused, `startCapture` reports the refusal back as a banner note, and the
// shortcut named there always works. Stopping needs no permission.
//
// Meet is a single-page app: joining a call replaces the green room in place
// with no navigation, so this observes the DOM rather than reading it once.
//
// Wrapped in an async IIFE because a content script is a classic script, not a
// module — top-level await here would be a syntax error, and the whole script
// would silently never run.

(async () => {
  const lib = await import(chrome.runtime.getURL('lib/meet.js'));

  const SHORTCUT = /Mac/i.test(navigator.userAgent) ? '⌘⇧U' : 'Ctrl+Shift+U';

  let host = null;
  let shadow = null;
  let lastSent = null;
  let dismissedCode = null;
  let debounce = null;

  function ensureBanner() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'meet-recorder-banner-host';
    // A shadow root so Meet's stylesheet and ours cannot reach each other.
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        .bar {
          position: fixed; z-index: 2147483647; left: 50%; transform: translateX(-50%);
          bottom: 6.5rem; display: flex; gap: .75rem; align-items: center;
          font: 500 13px/1 system-ui, sans-serif; color: #fff;
          background: #202124; border: 1px solid #5f6368; border-radius: 2rem;
          padding: .7rem 1rem; box-shadow: 0 2px 12px rgba(0,0,0,.4);
        }
        .bar[data-state="recording"] { background: #8c1d18; border-color: #f2b8b5; }
        .bar[data-state="warn"] { background: #614a19; border-color: #f9d26a; }
        .bar[data-state="saved"] { background: #0d652d; border-color: #81c995; }
        .bar[data-state="saved"] .dot { display: none; }
        .dot { width: .55rem; height: .55rem; border-radius: 50%; background: #f28b82; }
        .bar[data-state="idle"] .dot { display: none; }
        button { all: unset; cursor: pointer; opacity: .7; padding: 0 .2rem; }
        button:hover { opacity: 1; }
        .act {
          opacity: 1; border: 1px solid currentColor; border-radius: 1rem;
          padding: .3rem .7rem; font-weight: 600;
        }
        .act:hover { background: rgba(255,255,255,.14); }
        .act[hidden] { display: none; }
      </style>
      <div class="bar" data-state="idle">
        <span class="dot"></span>
        <span class="msg"></span>
        <button class="act"></button>
        <button class="close" title="Dismiss">✕</button>
      </div>`;
    shadow.querySelector('.act').addEventListener('click', async () => {
      const action = shadow.querySelector('.act').dataset.action;
      if (!action) return;
      // Stopping needs no permission and always works. Starting may be refused
      // — Chrome only grants tab capture after the extension itself is invoked
      // — and startCapture reports that back as a banner note.
      await chrome.runtime.sendMessage({ type: `banner-${action}` }).catch(() => {});
    });
    shadow.querySelector('.close').addEventListener('click', () => {
      dismissedCode = lib.callCodeFromUrl(location.href);
      hideBanner();
    });
    document.documentElement.append(host);
  }

  function showBanner(state, message, action = null, actionLabel = '') {
    ensureBanner();
    shadow.querySelector('.bar').dataset.state = state;
    shadow.querySelector('.msg').textContent = message;
    const act = shadow.querySelector('.act');
    act.dataset.action = action ?? '';
    act.textContent = actionLabel;
    act.hidden = !action;
    host.style.display = '';
  }

  function hideBanner() {
    if (host) host.style.display = 'none';
  }

  function report() {
    const callCode = lib.callCodeFromUrl(location.href);
    const { inCall, ended, matchedBy } = callCode
      ? lib.detectInCall(document)
      : { inCall: false, ended: false, matchedBy: null };

    // Three cases, and the middle one is the whole point. Ended is definite —
    // leaving a call does not change the URL, so this is the only thing that
    // says the meeting is over, and it is what stops the recording. Only when
    // nothing at all is recognised does a call-shaped URL count as a call; the
    // banner may then appear a touch early, which beats never appearing.
    const active = Boolean(callCode) && !ended && (inCall || matchedBy === null);

    const key = `${active}:${callCode}`;
    if (key === lastSent) return;
    lastSent = key;

    chrome.runtime
      .sendMessage({ type: 'call-state', inCall: active, callCode, matchedBy })
      .catch(() => {}); // the worker may be asleep; it will ask again

    if (active && callCode !== dismissedCode) {
      // The shortcut is named next to the button because the button is the
      // path that can be refused and the shortcut is the one that cannot.
      showBanner('idle', `Record this meeting — ${SHORTCUT}`, 'start', 'Record');
    } else if (!active) {
      hideBanner();
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'recording-state') return;
    if (msg.state === 'recording') {
      showBanner('recording', msg.note || 'Recording this meeting', 'stop', 'Stop & save');
    } else if (msg.state === 'warn') {
      showBanner('warn', msg.note || 'Check the recording', 'stop', 'Stop & save');
    } else if (msg.state === 'saved') {
      showBanner('saved', msg.note || 'Saved');
      // Confirmation, not a permanent fixture — go back to offering a record.
      setTimeout(() => {
        lastSent = null;
        report();
      }, 6000);
    }
    else if (msg.state === 'idle') {
      // A note here means the start was refused. Keep the button, so trying
      // again after doing what the note asks is one click.
      if (msg.note) showBanner('warn', msg.note, 'start', 'Record');
      else {
        lastSent = null; // force the next report to re-render the idle banner
        report();
      }
    }
  });

  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(report, 400);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  report();
})();
