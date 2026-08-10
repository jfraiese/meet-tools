// Whisper's two runtimes disagree about both the shape and the unit: one
// reports seconds under `segments`, the other milliseconds under
// `transcription`. Diarization merges on time, so getting this wrong misplaces
// every speaker label by a factor of a thousand.

import test from 'node:test';
import assert from 'node:assert/strict';

const { parseWhisperSegments } = await import('../lib/segments.js');

test('openai-whisper segments are read in seconds', () => {
  const json = {
    segments: [
      { id: 0, start: 0, end: 2.24, text: ' entonces ahora tengo que simplificarlos' },
      { id: 1, start: 2.24, end: 5.1, text: ' y hacer lo que me queda pendiente' },
    ],
  };
  assert.deepEqual(parseWhisperSegments(json), [
    { start: 0, end: 2.24, text: 'entonces ahora tengo que simplificarlos' },
    { start: 2.24, end: 5.1, text: 'y hacer lo que me queda pendiente' },
  ]);
});

test('whisper.cpp offsets are milliseconds and are converted', () => {
  const json = {
    transcription: [
      { offsets: { from: 0, to: 5000 }, text: ' Sigo con la landing.' },
      { offsets: { from: 5000, to: 8500 }, text: ' Dale.' },
    ],
  };
  assert.deepEqual(parseWhisperSegments(json), [
    { start: 0, end: 5, text: 'Sigo con la landing.' },
    { start: 5, end: 8.5, text: 'Dale.' },
  ]);
});

test('an unrecognised shape yields nothing rather than nonsense', () => {
  assert.deepEqual(parseWhisperSegments({}), []);
  assert.deepEqual(parseWhisperSegments(null), []);
  assert.deepEqual(parseWhisperSegments({ segments: [] }), []);
});

test('segments with no text are dropped', () => {
  const json = {
    segments: [
      { start: 0, end: 1, text: '   ' },
      { start: 1, end: 2, text: 'ok' },
    ],
  };
  assert.deepEqual(parseWhisperSegments(json), [{ start: 1, end: 2, text: 'ok' }]);
});
