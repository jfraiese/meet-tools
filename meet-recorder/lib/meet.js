// What counts as "a Google Meet call", from a URL and from the page.
//
// The URL cannot tell a live call from the pre-join green room or from the
// screen you land on after hanging up — all three are meet.google.com/<code>,
// and leaving a call does not navigate. So the DOM decides.
//
// Detection is three-valued on purpose: in a call, definitely out of one, or
// unable to tell. An earlier version had only the first and last, and treated
// "cannot tell" as "still in a call" — which meant a call that ended looked
// exactly like one still running, and recordings never stopped by themselves.

const CALL_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/** The call code in a Meet URL, or null if that URL is not a call. */
export function callCodeFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== 'meet.google.com') return null;
  const first = parsed.pathname.split('/').filter(Boolean)[0];
  if (!first) return null;
  const code = first.toLowerCase();
  return CALL_CODE.test(code) ? code : null;
}

export const isCallUrl = (url) => callCodeFromUrl(url) !== null;

/**
 * The call is over. Captured from a real Meet: `data-call-ended` appears only
 * on the post-hangup screen, and it is an attribute rather than a label, so it
 * survives translation.
 *
 * Do not be tempted by `data-in-call="true"` — it is present both during a call
 * and after it ends. It describes how the page was launched, not its state.
 */
export const CALL_ENDED_SELECTORS = ['[data-call-ended]'];

/**
 * The call is live. Ordered by confidence: the tooltip anchor is structural and
 * survives translation; the labels are the readable fallback and are listed in
 * the languages this is actually used in.
 */
export const IN_CALL_SELECTORS = [
  '[data-promo-anchor-id]',
  'button[aria-label="Leave call"]',
  'button[aria-label="Salir de la llamada"]',
  'button[aria-label="Abandonar la llamada"]',
];

/**
 * Your microphone is muted *in Meet*.
 *
 * This matters more than it looks. The extension captures the microphone
 * through getUserMedia, which Meet's mute button does not touch — so without
 * this, muting yourself and muttering puts the mutter in the recording and in
 * the transcript, having been heard by nobody in the meeting.
 *
 * Ordered by confidence, same as call detection: the attribute is structural
 * and survives translation, the labels are the readable fallback.
 */
// Two things captured from a real call shape these, and both were nearly
// expensive:
//
//  1. `data-is-muted` is on more than one control. In a call with the camera on
//     and the microphone muted, the page carries `data-is-muted="true"` *and*
//     `data-is-muted="false"` at once — the second is the camera. A bare
//     `[data-is-muted="true"]` therefore reads "camera off" as "microphone
//     muted", and would silently drop your side of a recording because you
//     turned your camera off. So the attribute is only trusted on an element
//     that also says it is the microphone.
//
//  2. You can mute *other people* in Meet, and those controls are labelled
//     "Mute <name>'s microphone". A selector on `[aria-label^="Mute"]` matches
//     them, so a page with anyone else on it would always look live. Only the
//     labels Meet uses for your own toggle are listed.
//
// No tag qualifier: Meet's controls are not always <button>, and requiring one
// is a way to match nothing while looking correct.
export const MIC_MUTED_SELECTORS = [
  '[data-is-muted="true"][aria-label*="microphone" i]',
  '[data-is-muted="true"][aria-label*="micrófono" i]',
  '[aria-label^="Turn on microphone"]',
  '[aria-label^="Activar micrófono"]',
  '[aria-label^="Activar el micrófono"]',
];

export const MIC_LIVE_SELECTORS = [
  '[data-is-muted="false"][aria-label*="microphone" i]',
  '[data-is-muted="false"][aria-label*="micrófono" i]',
  '[aria-label^="Turn off microphone"]',
  '[aria-label^="Desactivar micrófono"]',
  '[aria-label^="Desactivar el micrófono"]',
];

/**
 * `{ muted, matchedBy }`, where muted is true, false, or null for "cannot tell".
 *
 * Null is not muted. Unrecognised markup must never silently drop your side of
 * a recording — a meeting you can only half hear is a worse outcome than a
 * muttered aside surviving, and it is the one you cannot fix afterwards.
 */
export function detectMuted(root) {
  const muted = firstMatch(root, MIC_MUTED_SELECTORS);
  if (muted) return { muted: true, matchedBy: muted };

  const live = firstMatch(root, MIC_LIVE_SELECTORS);
  if (live) return { muted: false, matchedBy: live };

  return { muted: null, matchedBy: null };
}

/**
 * How many people are in the call, counted from the participant tiles.
 *
 * Every tile carries a "More options for <name>" control, which is where this
 * number comes from. That makes it a count of *visible tiles*, which is not
 * always the same as the number of people: Meet stops rendering a tile per
 * person in large calls, and someone who never turns on a camera or speaks may
 * not get one.
 *
 * So it is reported with its source and never as a fact. It exists to save
 * typing when transcribing — the diarizer has to be told how many people spoke,
 * and this is a better first guess than nothing.
 */
export const PARTICIPANT_TILE_SELECTORS = [
  '[aria-label^="More options for "]',
  '[aria-label^="Más opciones de "]',
];

export function countParticipants(root) {
  for (const selector of PARTICIPANT_TILE_SELECTORS) {
    try {
      const found = root.querySelectorAll(selector).length;
      if (found > 0) return { count: found, source: selector };
    } catch {
      // A malformed selector must not take the whole probe down.
    }
  }
  return { count: null, source: null };
}

const firstMatch = (root, selectors) => {
  for (const sel of selectors) {
    try {
      if (root.querySelector(sel)) return sel;
    } catch {
      // A malformed selector must not take the whole probe down.
    }
  }
  return null;
};

/**
 * Read the page's call state. `root` need only implement querySelector.
 *
 * Returns `{ inCall, ended, matchedBy }`. Both false with `matchedBy: null`
 * means the markup changed and nothing was recognised — the caller decides what
 * to assume, and should say that it is assuming.
 */
export function detectInCall(root) {
  const ended = firstMatch(root, CALL_ENDED_SELECTORS);
  if (ended) return { inCall: false, ended: true, matchedBy: ended };

  const live = firstMatch(root, IN_CALL_SELECTORS);
  if (live) return { inCall: true, ended: false, matchedBy: live };

  return { inCall: false, ended: false, matchedBy: null };
}
