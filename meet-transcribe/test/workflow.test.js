// The two plists that make a Quick Action. A malformed one does not error —
// the menu item simply never appears — so they are linted here rather than
// debugged in Finder.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const { buildInfoPlist, buildDocumentWflow, buildCommand, escapeXml, stableNodePath, SERVICE_NAME } =
  await import('../lib/workflow.js');

const lint = (contents, name) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-')), name);
  fs.writeFileSync(file, contents);
  execFileSync('/usr/bin/plutil', ['-lint', file]); // throws if malformed
  return file;
};

test('the Info.plist is valid and offers the action to Finder only', () => {
  const plist = buildInfoPlist({});
  lint(plist, 'Info.plist');
  assert.match(plist, /runWorkflowAsService/);
  assert.match(plist, /com\.apple\.finder/);
  assert.match(plist, /public\.audio/);
  assert.match(plist, new RegExp(SERVICE_NAME));
});

test('the workflow is valid and carries the command it should run', () => {
  const wflow = buildDocumentWflow({ command: '/usr/local/bin/node /repo/transcribe.js "$@"' });
  lint(wflow, 'document.wflow');
  assert.match(wflow, /Run Shell Script\.action/);
  assert.match(wflow, /\/repo\/transcribe\.js/);
  assert.match(wflow, /com\.apple\.Automator\.servicesMenu/);
});

test('the command reaches tools a Quick Action would not otherwise find', () => {
  // Measured: a Quick Action runs with PATH=/usr/bin:/bin:/usr/sbin:/sbin, and
  // `launchctl getenv PATH` is empty. Naming node absolutely is not enough —
  // the pipeline also shells out to whisper-cli, whisper, ffmpeg and ffprobe,
  // and none of those four are in that PATH. Without this the action reports
  // "No Whisper found" on a machine where whisper-cli runs fine in a terminal.
  const command = buildCommand({ node: '/opt/homebrew/bin/node', script: '/repo/transcribe.js' });
  assert.match(command, /\/opt\/homebrew\/bin/); // Homebrew, arm64
  assert.match(command, /\/usr\/local\/bin/); // Homebrew, Intel
  assert.match(command, /\$HOME\/\.local\/bin/); // pipx, for openai-whisper
  assert.match(command, /:"?\$PATH/); // adds to what is there, never replaces it
  assert.match(command, /"\/opt\/homebrew\/bin\/node" "\/repo\/transcribe\.js" "\$@"/);
});

test('a configured language is baked into the action, and omitted otherwise', () => {
  // The Quick Action has no terminal and cannot read a shell environment, so
  // the bundle is where its configuration lives — as it already is for node's
  // path and the checkout's path.
  const withLang = buildCommand({
    node: '/opt/homebrew/bin/node',
    script: '/repo/transcribe.js',
    language: 'es',
  });
  assert.match(withLang, /--language es/);
  // The flag precedes "$@" so that a path Finder passes is never read as its
  // value, and so a flag typed by hand later still wins.
  assert.ok(withLang.indexOf('--language es') < withLang.indexOf('"$@"'));

  const without = buildCommand({ node: '/opt/homebrew/bin/node', script: '/repo/transcribe.js' });
  assert.ok(!without.includes('--language'), 'auto-detect stays the default');
});

test('a generated command still produces a lintable workflow', () => {
  const command = buildCommand({ node: '/opt/homebrew/bin/node', script: '/repo/a & b/x.js' });
  const wflow = buildDocumentWflow({ command });
  lint(wflow, 'document.wflow');
  assert.match(wflow, /a &amp; b/);
});

test('input arrives as arguments, not on stdin', () => {
  // inputMethod 1 is "as arguments". On stdin the script would receive one
  // newline-joined blob and quietly mishandle paths containing spaces.
  const wflow = buildDocumentWflow({ command: 'true' });
  assert.match(wflow, /<key>inputMethod<\/key>\s*<integer>1<\/integer>/);
});

test('a path with XML-hostile characters cannot break the plist', () => {
  const wflow = buildDocumentWflow({ command: 'node "/repo/a & b/<x>.js" "$@"' });
  lint(wflow, 'document.wflow');
  assert.match(wflow, /a &amp; b/);
  assert.match(wflow, /&lt;x&gt;/);
});

test('the baked-in node is the symlink that survives a brew upgrade', () => {
  // process.execPath is fully resolved: running Homebrew's bin/node reports
  // Cellar/node/<version>/bin/node, and `brew upgrade node` deletes that
  // directory — the action then dies with "command not found" until the
  // installer is re-run. The bin/node symlink is what survives the upgrade.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-node-'));
  fs.mkdirSync(path.join(tmp, 'cellar'));
  fs.mkdirSync(path.join(tmp, 'bin'));
  fs.writeFileSync(path.join(tmp, 'cellar', 'node'), '');
  fs.symlinkSync(path.join(tmp, 'cellar', 'node'), path.join(tmp, 'bin', 'node'));

  const node = stableNodePath({
    execPath: path.join(tmp, 'cellar', 'node'),
    dirs: [path.join(tmp, 'bin')],
    realpath: fs.realpathSync,
  });
  assert.equal(node, path.join(tmp, 'bin', 'node'));
});

test('a foreign or absent node keeps the binary that ran the installer', () => {
  // A prefix with no node must not be chosen, and neither may a node that is a
  // different binary — swapping interpreters behind the user's back is worse
  // than a path that goes stale.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-node-'));
  fs.mkdirSync(path.join(tmp, 'empty'));
  fs.mkdirSync(path.join(tmp, 'other'));
  fs.writeFileSync(path.join(tmp, 'other', 'node'), '');
  fs.writeFileSync(path.join(tmp, 'mine'), '');

  const execPath = path.join(tmp, 'mine');
  const absent = stableNodePath({ execPath, dirs: [path.join(tmp, 'empty')], realpath: fs.realpathSync });
  assert.equal(absent, execPath);
  const foreign = stableNodePath({ execPath, dirs: [path.join(tmp, 'other')], realpath: fs.realpathSync });
  assert.equal(foreign, execPath);
});

test('escapeXml handles the five characters that matter', () => {
  assert.equal(escapeXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
  assert.equal(escapeXml('plain'), 'plain');
});
