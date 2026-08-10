// Picking a Whisper. whisper.cpp is 5-10x faster on this hardware but needs a
// model file that brew does not install, so "is it on PATH" is not enough of a
// question — a whisper-cli with no model fails once per file, confusingly.

import test from 'node:test';
import assert from 'node:assert/strict';

const { chooseRuntime, findGgmlModel, missingRuntimeMessage, MODEL_DIRS } =
  await import('../lib/runtime.js');

const has =
  (...names) =>
  (name) =>
    names.includes(name);
const exists =
  (...paths) =>
  (candidate) =>
    paths.includes(candidate);
const none = () => false;

test('whisper.cpp wins when it has a model to run', () => {
  const model = `${MODEL_DIRS[0]}/ggml-large-v3.bin`;
  const result = chooseRuntime({
    hasCommand: has('whisper-cli', 'whisper'),
    fileExists: exists(model),
    env: {},
  });
  assert.deepEqual(result, { kind: 'whisper-cpp', model });
});

test('whisper.cpp without a model falls back rather than failing per file', () => {
  const result = chooseRuntime({
    hasCommand: has('whisper-cli', 'whisper'),
    fileExists: none,
    env: {},
  });
  assert.deepEqual(result, { kind: 'openai-whisper', model: 'large-v3' });
});

test('openai-whisper alone is used, which is the state of this machine today', () => {
  const result = chooseRuntime({ hasCommand: has('whisper'), fileExists: none, env: {} });
  assert.deepEqual(result, { kind: 'openai-whisper', model: 'large-v3' });
});

test('neither installed is reported, not guessed at', () => {
  const result = chooseRuntime({ hasCommand: none, fileExists: none, env: {} });
  assert.deepEqual(result, { kind: null, model: null });
  assert.match(missingRuntimeMessage(), /brew install whisper-cpp|pipx install openai-whisper/);
});

test('WHISPER_MODEL overrides the search, and is checked before the defaults', () => {
  const custom = '/somewhere/else/ggml-large-v3.bin';
  const result = chooseRuntime({
    hasCommand: has('whisper-cli'),
    fileExists: exists(custom, `${MODEL_DIRS[0]}/ggml-large-v3.bin`),
    env: { WHISPER_MODEL: custom },
  });
  assert.equal(result.model, custom);
});

test('a WHISPER_MODEL pointing at nothing does not win', () => {
  const real = `${MODEL_DIRS[0]}/ggml-large-v3.bin`;
  assert.equal(
    findGgmlModel({ fileExists: exists(real), env: { WHISPER_MODEL: '/gone.bin' } }),
    real,
  );
});

test('every search directory is tried, in order', () => {
  const last = `${MODEL_DIRS[MODEL_DIRS.length - 1]}/ggml-large-v3.bin`;
  assert.equal(findGgmlModel({ fileExists: exists(last), env: {} }), last);
});
