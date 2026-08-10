// The exact commands run against real audio, and where their output lands.
// These are strings a shell will execute, so a wrong flag here is a runtime
// failure per file rather than a compile error.

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  LOUDNORM,
  probeArgs,
  normalizeArgs,
  transcribeCommand,
  outputPaths,
  durationArgs,
  parseDuration,
  parseDecodedDuration,
  durationSeconds,
  estimateMinutes,
} = await import('../lib/audio.js');

test('the duration probe asks ffprobe for exactly one number', () => {
  const args = durationArgs('/in/meeting.m4a');
  assert.ok(args.includes('format=duration'));
  // nokey=1 lives inside the -of value, so this is a substring check on the
  // joined arguments rather than an element match.
  assert.match(args.join(' '), /nokey=1/, 'the value must come back bare, not labelled');
  assert.equal(args[args.length - 1], '/in/meeting.m4a');
});

test('normalising targets speech loudness at 16 kHz mono', () => {
  const args = normalizeArgs('/in/meeting.webm', '/tmp/meeting.wav');
  assert.ok(args.includes('-af'));
  assert.ok(args.includes(LOUDNORM));
  assert.equal(LOUDNORM, 'loudnorm=I=-16:TP=-1.5:LRA=11');
  assert.ok(args.includes('-ar') && args.includes('16000'));
  assert.ok(args.includes('-ac') && args.includes('1'));
  assert.equal(args[args.length - 1], '/tmp/meeting.wav');
});

test('probing measures volume without writing a file', () => {
  const args = probeArgs('/in/meeting.webm');
  assert.ok(args.includes('volumedetect'));
  assert.ok(args.includes('-f') && args.includes('null'));
  assert.ok(!args.includes('-y'), 'probing must never overwrite anything');
});

test('openai-whisper is given no --output_format, and no --language by default', () => {
  // --output_format takes one value, not a list, so "txt,srt" is rejected; its
  // default is already every format.
  //
  // --language is omitted rather than passed as "auto" because openai-whisper
  // has no such value — its default *is* auto-detect. Configuring a language
  // does add the flag; see 'a configured language reaches both runtimes'.
  const { command, args } = transcribeCommand(
    { kind: 'openai-whisper', model: 'large-v3' },
    '/tmp/x.wav',
    '/tmp/out',
  );
  assert.equal(command, 'whisper');
  assert.ok(args.includes('--model') && args.includes('large-v3'));
  assert.ok(args.includes('--output_dir') && args.includes('/tmp/out'));
  assert.ok(!args.includes('--language'));
  assert.ok(!args.some((a) => a.includes(',')), 'no comma-joined flag values');
});

test('whisper.cpp is pointed at its model file and asked for txt and srt', () => {
  const { command, args } = transcribeCommand(
    { kind: 'whisper-cpp', model: '/m/ggml-large-v3.bin' },
    '/tmp/x.wav',
    '/tmp/out',
  );
  assert.equal(command, 'whisper-cli');
  assert.ok(args.includes('-m') && args.includes('/m/ggml-large-v3.bin'));
  assert.ok(args.includes('-otxt') && args.includes('-osrt'));
});

test('whisper.cpp is told to auto-detect language and to write JSON', () => {
  // Without -l auto it defaults to English and silently returns English text
  // for Spanish audio — observed, not theorised. Without -oj there is no
  // machine-readable timing for diarization to merge against.
  const { args } = transcribeCommand(
    { kind: 'whisper-cpp', model: '/m/ggml-large-v3.bin' },
    '/tmp/x.wav',
    '/tmp/out',
  );
  assert.ok(args.includes('-l') && args.includes('auto'));
  assert.ok(args.includes('-oj'));
});

test('a configured language reaches both runtimes', () => {
  // Auto-detection reads only the first 30 seconds and applies the answer to
  // the whole file. 26 near-silent opening seconds were detected as Ukrainian
  // at p=0.40, and 11 minutes of Spanish came out as Ukrainian.
  const cpp = transcribeCommand({ kind: 'whisper-cpp', model: '/m/m.bin' }, '/tmp/x.wav', '/o', {
    language: 'es',
  });
  assert.ok(cpp.args.includes('-l') && cpp.args.includes('es'));
  assert.ok(!cpp.args.includes('auto'));

  const openai = transcribeCommand(
    { kind: 'openai-whisper', model: 'large-v3' },
    '/tmp/x.wav',
    '/o',
    { language: 'es' },
  );
  assert.ok(openai.args.includes('--language') && openai.args.includes('es'));
});

test('neither runtime carries decoded text forward as context', () => {
  // The default (-mc -1) lets one hallucinated opening segment become a
  // whole-file repetition loop: 302 identical lines against 144 real ones on
  // the same audio. Forcing the right language does not fix it on its own.
  const cpp = transcribeCommand({ kind: 'whisper-cpp', model: '/m/m.bin' }, '/tmp/x.wav', '/o');
  assert.ok(cpp.args.includes('-mc') && cpp.args.includes('0'));

  const openai = transcribeCommand(
    { kind: 'openai-whisper', model: 'large-v3' },
    '/tmp/x.wav',
    '/o',
  );
  assert.ok(openai.args.includes('--condition_on_previous_text'));
  assert.ok(openai.args.includes('False'));
});

test('VAD is used only when its model is actually present', () => {
  // Same degrade-do-not-fail rule the diarizer follows: a missing model means
  // a plainer transcription, never an error.
  const without = transcribeCommand({ kind: 'whisper-cpp', model: '/m/m.bin' }, '/tmp/x.wav', '/o');
  assert.ok(!without.args.includes('--vad'));
  assert.ok(!without.args.includes('-vm'));

  const with_ = transcribeCommand({ kind: 'whisper-cpp', model: '/m/m.bin' }, '/tmp/x.wav', '/o', {
    vadModel: '/c/ggml-silero-v5.1.2.bin',
  });
  assert.ok(with_.args.includes('--vad'));
  assert.ok(with_.args.includes('-vm') && with_.args.includes('/c/ggml-silero-v5.1.2.bin'));
});

test('openai-whisper is never given VAD arguments, which it does not have', () => {
  const { args } = transcribeCommand(
    { kind: 'openai-whisper', model: 'large-v3' },
    '/tmp/x.wav',
    '/o',
    { vadModel: '/c/ggml-silero-v5.1.2.bin' },
  );
  assert.ok(!args.includes('--vad'));
  assert.ok(!args.includes('-vm'));
});

test('no initial prompt is ever sent, under either runtime name', () => {
  // A jargon list is the obvious use for Whisper's initial prompt, and it was
  // built and then removed. `-mc 0` caps carried context at zero tokens and the
  // prompt lives in that context: measured, `--prompt` alongside `-mc 0` gives
  // byte-identical output to no prompt, with `prompt time = 0.00 ms / 1 runs`.
  // Raising the cap lets it through and then the prompt's style transfers — a
  // comma-separated list produced a transcript with no capitals or punctuation.
  const cpp = transcribeCommand({ kind: 'whisper-cpp', model: '/m/m.bin' }, '/tmp/x.wav', '/o');
  assert.ok(!cpp.args.includes('--prompt'));
  assert.ok(!cpp.args.includes('--carry-initial-prompt'));

  const openai = transcribeCommand(
    { kind: 'openai-whisper', model: 'large-v3' },
    '/tmp/x.wav',
    '/o',
  );
  assert.ok(!openai.args.includes('--initial_prompt'));
});

test('transcripts are named after the recording, beside it', () => {
  const paths = outputPaths('/Users/x/Downloads/meet-recordings/2026-08-10-1200-sync.webm');
  assert.equal(paths.txt, '/Users/x/Downloads/meet-recordings/2026-08-10-1200-sync.txt');
  assert.equal(paths.srt, '/Users/x/Downloads/meet-recordings/2026-08-10-1200-sync.srt');
  assert.equal(paths.stem, '2026-08-10-1200-sync');
});

test('a dot in the meeting name does not truncate the transcript name', () => {
  const paths = outputPaths('/x/2026-08-10-v1.2-planning.webm');
  assert.equal(paths.stem, '2026-08-10-v1.2-planning');
  assert.equal(paths.txt, '/x/2026-08-10-v1.2-planning.txt');
});

test('a file that knows its own duration is believed', () => {
  assert.equal(parseDuration('89.994000\n'), 89.994);
  assert.equal(durationSeconds({ probed: 89.994, decoded: 12 }), 89.994);
});

test('a headerless file gets its exact length from the decode that already ran', () => {
  // The recorder's own webm: MediaRecorder writes no duration header and
  // ffprobe reports N/A, but ffmpeg's final progress line states what it
  // actually decoded.
  const stderr =
    'size=N/A time=00:00:04.02 bitrate=N/A speed=1.1x\n' +
    'size=N/A time=00:07:17.16 bitrate=N/A speed=1.12e+03x elapsed=0:00:00.38';
  assert.equal(parseDuration('N/A'), null);
  assert.equal(parseDecodedDuration(stderr), 437.16);
  assert.equal(durationSeconds({ probed: null, decoded: 437.16 }), 437.16);
});

test('the last progress line wins, since ffmpeg prints one per update', () => {
  assert.equal(parseDecodedDuration('time=00:00:01.00\ntime=00:02:03.50'), 123.5);
  assert.equal(parseDecodedDuration('time=00:00:00.00'), null);
  assert.equal(parseDecodedDuration('no timing here'), null);
});

test('an unknown duration stays unknown rather than becoming a guess', () => {
  // Size-based estimation was measured 24% wrong on a real recording — 5:53
  // against a true 7:17 — and broke outright when the recorder's bitrate
  // changed. Saying nothing beats stating a wrong number as fact.
  assert.equal(durationSeconds({ probed: null, decoded: null }), null);
});

test('the wait is estimated from measured throughput, per runtime', () => {
  // Both measured on this machine: 0.45x realtime on CPU, 13x on Metal.
  // An hour-long meeting is the case where the difference is the whole story.
  assert.equal(estimateMinutes(3600, 'openai-whisper'), 133);
  assert.equal(estimateMinutes(3600, 'whisper-cpp'), 5);
});

test('an unknown runtime is estimated conservatively, not optimistically', () => {
  // Guessing fast and being slow is the worse error: it invites the user to
  // wait by the machine for something that takes half an hour.
  assert.equal(estimateMinutes(3600, 'something-else'), 133);
});
