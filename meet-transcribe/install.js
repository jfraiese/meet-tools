#!/usr/bin/env node
// Install the Finder Quick Action.
//
// The bundle is generated, not checked in, because its shell action carries
// this checkout's absolute path and the absolute path of the node that will run
// it — a Quick Action runs with a minimal PATH, so `node` alone is not enough.
// The same PATH hides whisper-cli, whisper, ffmpeg and ffprobe, which is why
// buildCommand prepends the directories they live in.
//
// Move this repo and the action breaks; re-run this to fix it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildInfoPlist, buildDocumentWflow, buildCommand, stableNodePath, SERVICE_NAME } from './lib/workflow.js';

const SERVICES_DIR = path.join(os.homedir(), 'Library', 'Services');
const BUNDLE = path.join(SERVICES_DIR, `${SERVICE_NAME}.workflow`);

// fileURLToPath, not new URL(...).pathname: the latter percent-encodes, so a
// checkout under a path with a space would be written into the bundle as %20
// and the action would fail with "no such file".
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'transcribe.js');

function refreshServices() {
  try {
    execFileSync('/System/Library/CoreServices/pbs', ['-flush']);
  } catch {
    // Not fatal: the menu appears anyway, sometimes after a Finder restart.
  }
}

function install({ language }) {
  const node = stableNodePath({ execPath: process.execPath, realpath: fs.realpathSync });
  const command = buildCommand({ node, script, language });
  const contents = path.join(BUNDLE, 'Contents');
  fs.mkdirSync(contents, { recursive: true });
  fs.writeFileSync(path.join(contents, 'Info.plist'), buildInfoPlist({}));
  fs.writeFileSync(path.join(contents, 'document.wflow'), buildDocumentWflow({ command }));

  // A malformed plist is silent in Finder — no menu item, no error. Refuse to
  // leave one installed.
  for (const file of ['Info.plist', 'document.wflow']) {
    execFileSync('/usr/bin/plutil', ['-lint', path.join(contents, file)], { stdio: 'ignore' });
  }

  refreshServices();
  console.log(`Installed: ${BUNDLE}`);
  console.log(`Runs: ${command}`);
  console.log(`Right-click a recording in Finder → Quick Actions → ${SERVICE_NAME}`);
}

function uninstall() {
  fs.rmSync(BUNDLE, { recursive: true, force: true });
  refreshServices();
  console.log(`Removed: ${BUNDLE}`);
}

// `--language es` is written into the action. Without it the action detects,
// which reads only the first 30 seconds of a file and gets it wrong on a call
// that opens with silence.
//
// Both spellings are accepted and anything else is refused. `--language=es`
// used to match nothing and install auto-detect while printing a success
// message, which is the same silent-wrong-answer failure the flag exists to fix.
function parseInstallArgs(argv) {
  let language = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--uninstall') return { uninstall: true, language: null };
    if (arg === '--language' || arg.startsWith('--language=')) {
      language = arg === '--language' ? argv[++i] : arg.slice('--language='.length);
      if (!language || language.startsWith('--')) {
        throw new Error('--language needs a value, e.g. --language es');
      }
      continue;
    }
    throw new Error(`unknown option ${arg}\nusage: install.js [--language es] [--uninstall]`);
  }
  return { uninstall: false, language };
}

let options;
try {
  options = parseInstallArgs(process.argv.slice(2));
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

if (options.uninstall) uninstall();
else install({ language: options.language });
