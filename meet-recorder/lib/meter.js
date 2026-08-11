// Turning what the analyser measures into something a person can read.
//
// Peak amplitude plotted linearly is useless: speech spends its whole life in
// the bottom tenth of 0..1, so a linear meter sits nearly empty during normal
// conversation and pins only on a cough. Hearing is logarithmic and so is this.

export const SEGMENTS = 14;

// The band a meeting actually occupies. The floor is the recorder's own silence
// floor (0.004 peak ≈ −48 dB) with a little room beneath it, so "nothing at
// all" and "someone breathing" do not both read as empty. The ceiling is just
// under the −6 dB of headroom the mix is recorded at, so a healthy voice fills
// most of the meter rather than a third of it.
export const FLOOR_DB = -54;
export const CEIL_DB = -3;

/** 0 when there is nothing there, 1 when the source is as loud as it will get. */
export function levelFraction(peak) {
  if (!(peak > 0)) return 0;
  const db = 20 * Math.log10(peak);
  const fraction = (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB);
  return Math.max(0, Math.min(1, fraction));
}

/** How many segments to light. Rounds, so a whisper lights at least one. */
export const litSegments = (peak, segments = SEGMENTS) =>
  Math.round(levelFraction(peak) * segments);

const two = (n) => String(n).padStart(2, '0');

/**
 * Hours only once there are hours. A meeting that has run four minutes should
 * not be reported as `00:04:12` — the leading zeros read as a stopwatch nobody
 * asked for, and the common case is the short one.
 */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}
