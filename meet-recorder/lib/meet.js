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
