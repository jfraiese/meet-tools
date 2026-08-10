// Where a recording lands and what is written beside it.
//
// The basename carries the date, the local time, the meeting's own name when
// it has one, and always the call code — so a folder of these sorts
// chronologically and still says which call each was.

const pad = (n) => String(n).padStart(2, '0');

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip the accents NFD just split off
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The tab title with Meet's own furniture removed. '' when nothing is left. */
export function cleanTitle(tabTitle, callCode) {
  const stripped = String(tabTitle ?? '')
    .replace(/\s*[-–—]\s*Google Meet\s*$/i, '')
    .replace(/^\s*Meet\s*[-–—]\s*/i, '')
    .trim();
  const slug = slugify(stripped);
  return slug === slugify(callCode) ? '' : slug;
}

export function recordingBasename({ startedAt, tabTitle, callCode }) {
  const d = startedAt;
  const stamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const title = cleanTitle(tabTitle, callCode);
  return [stamp, title, callCode].filter(Boolean).join('-');
}

/**
 * `sources` is `{ micActiveMs, tabActiveMs }` — how long each side carried
 * sound, not a verdict about whether it worked. A verdict was tried and had to
 * be withdrawn: nothing observable in a 30-second window separates a dead
 * microphone from someone listening politely.
 */
export function buildSidecar({ startedAt, endedAt, callCode, tabTitle, stopReason, sources }) {
  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    callCode,
    tabTitle: String(tabTitle ?? ''),
    stopReason,
    sources,
  };
}
