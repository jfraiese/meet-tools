// The merge rule is where diarization either works or quietly mislabels
// everything, and it is pure, so every awkward case is a test rather than a
// 48-second experiment.

import test from 'node:test';
import assert from 'node:assert/strict';

const { diarizeArgs, parseTurns, assignSpeakers, applyNames, formatText, formatSrt } =
  await import('../lib/diarize.js');

test('a known speaker count is passed as num-clusters, which is exact', () => {
  const args = diarizeArgs({
    wav: '/tmp/x.wav',
    segmentationModel: '/m/seg.onnx',
    embeddingModel: '/m/emb.onnx',
    speakers: 3,
  });
  assert.ok(args.includes('--clustering.num-clusters=3'));
  assert.ok(!args.some((a) => a.startsWith('--clustering.cluster-threshold')));
  assert.ok(args.includes('--print-args=false'), 'or the config dump lands in stdout');
  assert.ok(args.includes('--segmentation.provider=coreml'));
  assert.equal(args[args.length - 1], '/tmp/x.wav');
});

test('an unknown speaker count falls back to a threshold', () => {
  const args = diarizeArgs({
    wav: '/tmp/x.wav',
    segmentationModel: '/m/seg.onnx',
    embeddingModel: '/m/emb.onnx',
    speakers: null,
  });
  assert.ok(args.some((a) => a.startsWith('--clustering.cluster-threshold=')));
  assert.ok(!args.some((a) => a.startsWith('--clustering.num-clusters')));
});

test('turns are read from the real output format', () => {
  const stdout = `Started
0.031 -- 1.027 speaker_01
3.102 -- 5.482 speaker_00
`;
  assert.deepEqual(parseTurns(stdout), [
    { start: 0.031, end: 1.027, speaker: 'SPEAKER_01' },
    { start: 3.102, end: 5.482, speaker: 'SPEAKER_00' },
  ]);
});

test('noise around the turns is ignored', () => {
  assert.deepEqual(parseTurns('OfflineSpeakerDiarizationConfig(...)\nStarted\n'), []);
  assert.deepEqual(parseTurns(''), []);
});

test('a segment takes the speaker it overlaps most', () => {
  const turns = [
    { start: 0, end: 10, speaker: 'SPEAKER_00' },
    { start: 10, end: 20, speaker: 'SPEAKER_01' },
  ];
  const segments = [{ start: 8, end: 18, text: 'mostly the second' }];
  assert.equal(assignSpeakers(segments, turns)[0].speaker, 'SPEAKER_01');
});

test('a segment spanning three turns takes the middle one when it dominates', () => {
  const turns = [
    { start: 0, end: 1, speaker: 'SPEAKER_00' },
    { start: 1, end: 9, speaker: 'SPEAKER_01' },
    { start: 9, end: 10, speaker: 'SPEAKER_02' },
  ];
  assert.equal(assignSpeakers([{ start: 0, end: 10, text: 'x' }], turns)[0].speaker, 'SPEAKER_01');
});

test('a short interjection nested in a long turn keeps its own speaker', () => {
  // The failure that made the first real transcript useless. The diarizer emits
  // overlapping turns, so a half-second interjection sits inside a ten-second
  // run by someone else. Plain maximum overlap gave it to the long turn, and
  // one speaker swallowed a three-way conversation.
  const turns = [
    { start: 11.101, end: 21.597, speaker: 'SPEAKER_00' },
    { start: 18.965, end: 19.285, speaker: 'SPEAKER_02' },
  ];
  const segment = [{ start: 18.9, end: 19.3, text: '¿Y qué te dijo?' }];
  assert.equal(assignSpeakers(segment, turns)[0].speaker, 'SPEAKER_02');
});

test('a dominant turn still wins over a brief clip of its neighbour', () => {
  // The other side of the same rule: weighting must not make every short turn
  // win, only the ones the segment actually belongs to.
  const turns = [
    { start: 0, end: 10, speaker: 'SPEAKER_00' },
    { start: 9.9, end: 10.0, speaker: 'SPEAKER_01' },
  ];
  assert.equal(assignSpeakers([{ start: 0, end: 10, text: 'x' }], turns)[0].speaker, 'SPEAKER_00');
});

test('an exact tie goes to the earlier turn, so results are deterministic', () => {
  const turns = [
    { start: 0, end: 5, speaker: 'SPEAKER_00' },
    { start: 5, end: 10, speaker: 'SPEAKER_01' },
  ];
  assert.equal(assignSpeakers([{ start: 0, end: 10, text: 'x' }], turns)[0].speaker, 'SPEAKER_00');
});

test('a segment in a gap continues the previous speaker', () => {
  // A stray UNKNOWN mid-conversation reads as a bug, and continuing is right
  // far more often than not.
  const turns = [{ start: 0, end: 5, speaker: 'SPEAKER_02' }];
  const out = assignSpeakers(
    [
      { start: 0, end: 5, text: 'first' },
      { start: 50, end: 55, text: 'orphan' },
    ],
    turns,
  );
  assert.equal(out[1].speaker, 'SPEAKER_02');
});

test('an orphan with no previous speaker is SPEAKER_00', () => {
  const out = assignSpeakers(
    [{ start: 50, end: 55, text: 'orphan' }],
    [{ start: 0, end: 5, speaker: 'SPEAKER_03' }],
  );
  assert.equal(out[0].speaker, 'SPEAKER_00');
});

test('no turns at all leaves segments unlabelled rather than inventing a speaker', () => {
  const out = assignSpeakers([{ start: 0, end: 1, text: 'x' }], []);
  assert.equal(out[0].speaker, null);
});

test('names map in order of first appearance, not label order', () => {
  const labelled = [
    { start: 0, end: 1, text: 'a', speaker: 'SPEAKER_02' },
    { start: 1, end: 2, text: 'b', speaker: 'SPEAKER_00' },
  ];
  const { labelled: named, mapping } = applyNames(labelled, ['Julián', 'Isma']);
  assert.equal(named[0].speaker, 'Julián');
  assert.equal(named[1].speaker, 'Isma');
  assert.deepEqual(mapping, { SPEAKER_02: 'Julián', SPEAKER_00: 'Isma' });
});

test('too few names leaves the rest numbered; too many are reported', () => {
  const labelled = [
    { start: 0, end: 1, text: 'a', speaker: 'SPEAKER_00' },
    { start: 1, end: 2, text: 'b', speaker: 'SPEAKER_01' },
  ];
  assert.equal(applyNames(labelled, ['Ada']).labelled[1].speaker, 'SPEAKER_01');
  assert.deepEqual(applyNames(labelled, ['Ada', 'Bo', 'Cy']).unused, ['Cy']);
});

test('the text output prefixes each line with its speaker', () => {
  const out = formatText([
    { start: 0, end: 1, text: 'hola', speaker: 'Isma' },
    { start: 1, end: 2, text: 'qué tal', speaker: null },
  ]);
  assert.equal(out, 'Isma: hola\nqué tal\n');
});

test('the srt keeps valid cue timing with the speaker in the text', () => {
  const srt = formatSrt([{ start: 0, end: 1.5, text: 'hola', speaker: 'Isma' }]);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:01,500\nIsma: hola\n/);
});
