// Which recordings the automatic transcriber should pick up. Pure, so node
// --test can reach it; auto.js owns the disk and the clock.

/**
 * The recorder saves `<stem>.webm` and then `<stem>.json`. The sidecar landing
 * is the signal that the audio is complete. A recording rescued after a crash
 * (`-recovered`) gets no sidecar, so a bare .webm counts once it has sat
 * unchanged for `settleMs`. Chrome only gives the file its final name when the
 * download completes, so a recent mtime means the sidecar is on its way rather
 * than the audio still being written.
 *
 * Skipped: anything older than `since` (so installing this does not suddenly
 * churn through the archive), anything already transcribed, and anything
 * already tried. A file that fails or is too quiet would otherwise be retried
 * on every change to the folder, forever.
 *
 * Returns `{ ready, waiting }` as lists of stems. `waiting` is not empty when it
 * is worth looking again after `settleMs`.
 */
export function pendingRecordings({ names, mtimes, since, tried, now, settleMs = 15000 }) {
  const present = new Set(names);
  const ready = [];
  const waiting = [];
  for (const name of names) {
    if (!name.endsWith('.webm') || name.startsWith('.')) continue;
    const stem = name.slice(0, -'.webm'.length);
    const mtime = mtimes[name];
    if (mtime == null || mtime < since) continue;
    if (tried.includes(stem) || present.has(`${stem}.txt`)) continue;
    if (present.has(`${stem}.json`) || now - mtime >= settleMs) ready.push(stem);
    else waiting.push(stem);
  }
  return { ready: ready.sort(), waiting: waiting.sort() };
}

/**
 * The speaker count to pass on, from the recorder's sidecar: its
 * `participants`, which includes you. `null` when the sidecar has no usable
 * number. transcribe.js then asks, exactly as it does from Finder.
 */
export function speakersFromSidecar(sidecar) {
  const n = sidecar?.participants;
  return Number.isInteger(n) && n >= 1 ? n : null;
}
