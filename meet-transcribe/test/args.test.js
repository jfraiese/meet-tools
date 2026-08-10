// The command line. Every case here is one that previously failed silently:
// the tool did something other than what was typed, and said nothing about it.

import test from 'node:test';
import assert from 'node:assert/strict';

const { parseArgs, USAGE } = await import('../lib/args.js');

test('files and flags are told apart', () => {
  const a = parseArgs(['--force', 'a.webm', '--speakers', '3', 'b.m4a']);
  assert.deepEqual(a.files, ['a.webm', 'b.m4a']);
  assert.equal(a.force, true);
  assert.equal(a.speakers, 3);
});

test('a value is never mistaken for a recording', () => {
  // `3` and `Ada,Bo` are values. Treating them as filenames produced "no such
  // file: 3" and transcribed nothing.
  const a = parseArgs(['--speakers', '3', '--names', 'Ada,Bo', 'x.webm']);
  assert.deepEqual(a.files, ['x.webm']);
  assert.deepEqual(a.names, ['Ada', 'Bo']);
});

test('--language=es works, not just --language es', () => {
  // The = form matched nothing and installed auto-detect instead, which is how
  // eleven minutes of Spanish came out as Ukrainian.
  assert.equal(parseArgs(['--language=es', 'x.webm']).language, 'es');
  assert.equal(parseArgs(['--language', 'es', 'x.webm']).language, 'es');
});

test('no language means auto-detect', () => {
  assert.equal(parseArgs(['x.webm']).language, 'auto');
});

test('the last occurrence wins, so a typed flag beats the baked-in one', () => {
  // The Quick Action's command is `transcribe.js --language es "$@"`, so
  // anything typed by hand arrives later and has to override.
  assert.equal(parseArgs(['--language', 'es', 'x.webm', '--language', 'pt']).language, 'pt');
});

test('a misspelled flag is refused, not treated as a filename', () => {
  assert.throws(() => parseArgs(['--speakrs', '3', 'x.webm']), /unknown option --speakrs/);
});

test('a value flag with no value is refused', () => {
  assert.throws(() => parseArgs(['x.webm', '--speakers']), /--speakers needs a value/);
  // The next token being a flag means the value was forgotten, not supplied.
  assert.throws(() => parseArgs(['--speakers', '--force', 'x.webm']), /--speakers needs a value/);
});

test('a boolean flag given a value is refused', () => {
  assert.throws(() => parseArgs(['--force=yes', 'x.webm']), /--force takes no value/);
});

test('the refusal carries the usage, since the caller has no terminal', () => {
  assert.throws(() => parseArgs(['--nope']), new RegExp(USAGE.split('\n')[0].slice(0, 20)));
});

test('a nonsense speaker count falls back to asking rather than to zero', () => {
  assert.equal(parseArgs(['--speakers', '0', 'x.webm']).speakers, null);
  assert.equal(parseArgs(['--speakers', 'many', 'x.webm']).speakers, null);
  assert.equal(parseArgs(['--speakers', '-2', 'x.webm']).speakers, null);
});

test('a filename containing = or spaces survives', () => {
  const a = parseArgs(['/Users/x/My Recordings/a=b.webm']);
  assert.deepEqual(a.files, ['/Users/x/My Recordings/a=b.webm']);
});
