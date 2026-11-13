// Starting a recording by itself when a call begins.
//
// This is only possible because Chrome was launched with
// `--allowlisted-extension-id=<this extension>`: without that flag,
// tabCapture.getMediaStreamId refuses any tab the extension was not invoked on,
// and a call starting is not an invocation. With the flag missing the attempt
// fails cleanly and the shortcut still works — the launcher is what makes this
// automatic, not this file.
//
// Pure, so node --test can reach it. The worker owns the storage.

/** One attempt per call per tab. */
export const callKey = (tabId, callCode) => `${tabId}:${callCode}`;

/**
 * Whether a `call-state` report from the page should start a recording.
 *
 * Only on a *positive* in-call reading. The page also reports a call-shaped URL
 * as active when no marker matched at all — right for showing a banner, wrong
 * for recording, because that is also what the green room looks like when
 * Meet's markup changes.
 *
 * And only once per call: after you stop a recording by hand the page keeps
 * saying you are in the call, and taking that as a cue to start again would
 * make Stop mean nothing. `handled` is cleared when the call ends, so leaving
 * and rejoining records again.
 */
export function shouldAutoStart({ enabled, idle, inCall, matchedBy, callCode, tabId, handled }) {
  if (enabled === false) return false; // unset means on
  if (!idle || !inCall || !matchedBy || !callCode || tabId == null) return false;
  return !handled.includes(callKey(tabId, callCode));
}

/** `handled`, with every call in this tab forgotten — it left its call. */
export function forgetTab(handled, tabId) {
  return handled.filter((key) => !key.startsWith(`${tabId}:`));
}
