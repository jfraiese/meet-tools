// The name a recording lands under, and the JSON written beside it. Dates are
// built with local-time constructors so this test says the same thing in every
// timezone.

import test from 'node:test';
import assert from 'node:assert/strict';

const { slugify, cleanTitle, recordingBasename, buildSidecar } =
  await import('../lib/filename.js');

test('slugify produces something a filesystem is happy with', () => {
  assert.equal(slugify('Weekly Sync'), 'weekly-sync');
  assert.equal(slugify('  Planificación  del   sprint '), 'planificacion-del-sprint');
  assert.equal(slugify('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
  assert.equal(slugify('---'), '');
  assert.equal(slugify(''), '');
});

test('cleanTitle strips what Meet puts there and keeps what you named it', () => {
  assert.equal(cleanTitle('Weekly sync - Google Meet', 'abc-defg-hij'), 'weekly-sync');
  assert.equal(cleanTitle('Meet – abc-defg-hij', 'abc-defg-hij'), '');
  assert.equal(cleanTitle('Meet - abc-defg-hij', 'abc-defg-hij'), '');
  assert.equal(cleanTitle('abc-defg-hij', 'abc-defg-hij'), '');
  assert.equal(cleanTitle('', 'abc-defg-hij'), '');
});

test('a named meeting keeps its name; an unnamed one is just date and code', () => {
  const startedAt = new Date(2026, 7, 10, 14, 3, 11);
  assert.equal(
    recordingBasename({ startedAt, tabTitle: 'Weekly sync - Google Meet', callCode: 'abc-defg-hij' }),
    '2026-08-10-1403-weekly-sync-abc-defg-hij',
  );
  assert.equal(
    recordingBasename({ startedAt, tabTitle: 'Meet – abc-defg-hij', callCode: 'abc-defg-hij' }),
    '2026-08-10-1403-abc-defg-hij',
  );
});

test('single-digit months, days, hours and minutes are padded', () => {
  const startedAt = new Date(2026, 0, 5, 9, 7, 0);
  assert.equal(
    recordingBasename({ startedAt, tabTitle: '', callCode: 'abc-defg-hij' }),
    '2026-01-05-0907-abc-defg-hij',
  );
});

test('the sidecar records duration and how long each source carried sound', () => {
  // How long, not whether it worked. The verdict this replaced was a one-way
  // latch: 30 seconds of listening while a colleague talked marked your
  // microphone dead, and it never recovered, so both sides always ended
  // 'silent' on a real call.
  const startedAt = new Date(2026, 7, 10, 14, 3, 11);
  const endedAt = new Date(2026, 7, 10, 14, 5, 11);
  const sidecar = buildSidecar({
    startedAt,
    endedAt,
    callCode: 'abc-defg-hij',
    tabTitle: 'Weekly sync - Google Meet',
    stopReason: 'call-ended',
    sources: { micActiveMs: 12000, tabActiveMs: 96000 },
  });
  assert.equal(sidecar.durationMs, 120000);
  assert.equal(sidecar.callCode, 'abc-defg-hij');
  assert.equal(sidecar.stopReason, 'call-ended');
  assert.deepEqual(sidecar.sources, { micActiveMs: 12000, tabActiveMs: 96000 });
  assert.equal(sidecar.startedAt, startedAt.toISOString());
  assert.equal(sidecar.endedAt, endedAt.toISOString());
});

test('a source that never carried sound is distinguishable from a quiet one', () => {
  // The whole point of the change: 0 is a dead source, small-but-nonzero is a
  // participant who mostly listened. The old shape reported both as 'silent'.
  const build = (sources) =>
    buildSidecar({
      startedAt: new Date(2026, 7, 10, 14, 0, 0),
      endedAt: new Date(2026, 7, 10, 15, 0, 0),
      callCode: 'abc-defg-hij',
      tabTitle: 't',
      stopReason: 'manual',
      sources,
    });
  assert.equal(build({ micActiveMs: 0, tabActiveMs: 2400000 }).sources.micActiveMs, 0);
  assert.equal(build({ micActiveMs: 400000, tabActiveMs: 2400000 }).sources.micActiveMs, 400000);
});
