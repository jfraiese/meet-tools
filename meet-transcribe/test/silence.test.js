// Reading ffmpeg's volumedetect output, and deciding whether a recording has
// enough signal to be worth transcribing. Whisper hallucinates fluent nonsense
// on near-silence — a real recording here produced a page of "Thank you so
// much for joining us" — so this guard is what separates "empty" from "wrong".

import test from 'node:test';
import assert from 'node:assert/strict';

const { parseVolumeStats, isTooQuiet, SILENCE_THRESHOLD_DB } =
  await import('../lib/silence.js');

// ffmpeg emits more than one volumedetect block; the first can be an empty
// pass with n_samples: 0 and no volume lines at all.
const REAL_OUTPUT = `
[Parsed_volumedetect_0 @ 0xa31028540] n_samples: 0
[Parsed_volumedetect_0 @ 0xa310289c0] n_samples: 495360
[Parsed_volumedetect_0 @ 0xa310289c0] mean_volume: -48.5 dB
[Parsed_volumedetect_0 @ 0xa310289c0] max_volume: -17.8 dB
[Parsed_volumedetect_0 @ 0xa310289c0] histogram_17db: 13
`;

test('the volume lines are read out of real ffmpeg output', () => {
  assert.deepEqual(parseVolumeStats(REAL_OUTPUT), { meanDb: -48.5, maxDb: -17.8 });
});

test('a later block wins, so a leading empty pass cannot shadow the real one', () => {
  const output = `
[Parsed_volumedetect_0 @ 0x1] mean_volume: -90.0 dB
[Parsed_volumedetect_0 @ 0x1] max_volume: -90.0 dB
[Parsed_volumedetect_0 @ 0x2] mean_volume: -21.4 dB
[Parsed_volumedetect_0 @ 0x2] max_volume: 0.0 dB
`;
  assert.deepEqual(parseVolumeStats(output), { meanDb: -21.4, maxDb: 0.0 });
});

test('output with no volume lines is null rather than a guess', () => {
  assert.equal(parseVolumeStats('ffmpeg version 8.0\nno filter ran'), null);
  assert.equal(parseVolumeStats(''), null);
});

test('the threshold splits the four real recordings the way they behaved', () => {
  // -21.4 and -24.2 transcribed well; -34.9 hallucinated; -48.5 was empty.
  assert.equal(isTooQuiet({ meanDb: -21.4, maxDb: 0.0 }), false);
  assert.equal(isTooQuiet({ meanDb: -24.2, maxDb: 0.0 }), false);
  assert.equal(isTooQuiet({ meanDb: -34.9, maxDb: -1.0 }), true);
  assert.equal(isTooQuiet({ meanDb: -48.5, maxDb: -17.8 }), true);
});

test('unreadable stats are not treated as silence', () => {
  // Failing to measure is not evidence of quiet. Transcribing a file we could
  // not measure is recoverable; refusing a good meeting is not.
  assert.equal(isTooQuiet(null), false);
});

test('the threshold is the calibrated one', () => {
  assert.equal(SILENCE_THRESHOLD_DB, -30);
});
