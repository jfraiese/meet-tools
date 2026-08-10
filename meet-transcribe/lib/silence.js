// Whether a recording has enough signal to be worth transcribing.
//
// Whisper does not fall silent on silence — it hallucinates fluently. One real
// recording here, 110 seconds at -34.9 dB mean, produced nothing but "Thank you
// so much for joining us" repeated, which is indistinguishable from a genuine
// transcript unless something checks first.
//
// The threshold is calibrated against four real recordings rather than chosen:
// -21.4 and -24.2 dB transcribed well, -34.9 hallucinated, -48.5 was empty.

export const SILENCE_THRESHOLD_DB = -30;

const MEAN = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/g;
const MAX = /max_volume:\s*(-?\d+(?:\.\d+)?) dB/g;

const lastMatch = (text, pattern) => {
  const found = [...String(text ?? '').matchAll(pattern)];
  return found.length ? Number(found[found.length - 1][1]) : null;
};

/**
 * Read ffmpeg's volumedetect output. ffmpeg emits a block per pass and the
 * first can be empty, so the last complete pair wins.
 */
export function parseVolumeStats(stderr) {
  const meanDb = lastMatch(stderr, MEAN);
  const maxDb = lastMatch(stderr, MAX);
  if (meanDb === null || maxDb === null) return null;
  return { meanDb, maxDb };
}

/** Null stats mean the measurement failed, which is not evidence of silence. */
export function isTooQuiet(stats, threshold = SILENCE_THRESHOLD_DB) {
  if (!stats) return false;
  return stats.meanDb < threshold;
}
