#!/usr/bin/env node
// Transcribe new recordings without being asked. Run by a LaunchAgent that
// watches ~/Downloads/meet-recordings (WatchPaths), so it starts whenever
// something lands there, works through whatever is new, and exits.
//
//   auto.js [--language es]
//
// It hands each file to transcribe.js, which notifies at the start and at the
// end exactly as it does from Finder. The speaker count comes from the
// recorder's sidecar. With no count there, transcribe.js shows its usual
// dialog.
//
// launchd never runs two copies of one job, and a change that lands mid-run is
// caught by scanning again before exiting, so there is no lock here.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { pendingRecordings, speakersFromSidecar } from './lib/auto.js';

// Overridable only so it can be exercised against a scratch folder.
const DIR = process.env.MEET_AUTO_DIR ?? path.join(os.homedir(), 'Downloads', 'meet-recordings');
const STATE =
  process.env.MEET_AUTO_STATE ??
  path.join(os.homedir(), 'Library', 'Application Support', 'meet-tools', 'auto-transcribe.json');
const SETTLE_MS = 15000;
const KEEP_TRIED = 300;

const here = path.dirname(fileURLToPath(import.meta.url));
const transcribeScript = path.join(here, 'transcribe.js');

const argv = process.argv.slice(2);
const langAt = argv.indexOf('--language');
const language = langAt >= 0 ? argv[langAt + 1] : null;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    // First run: start from now. Recordings already in the folder are yours
    // to transcribe by hand, or not.
    const fresh = { since: Date.now(), tried: [] };
    saveState(fresh);
    return fresh;
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  state.tried = state.tried.slice(-KEEP_TRIED);
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
}

function readSidecar(stem) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${stem}.json`), 'utf8'));
  } catch {
    return null;
  }
}

function transcribe(file, speakers) {
  const args = [transcribeScript];
  if (language) args.push('--language', language);
  if (speakers) args.push('--speakers', String(speakers));
  args.push(file);
  console.log(`[${new Date().toISOString()}] ${path.basename(file)} speakers=${speakers ?? 'ask'}`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code));
    child.on('error', (err) => {
      console.error(err);
      resolve(1);
    });
  });
}

async function main() {
  if (!fs.existsSync(DIR)) return;
  const state = loadState();

  // Bounded, so a folder that keeps changing underneath cannot spin forever.
  for (let round = 0; round < 50; round += 1) {
    const names = fs.readdirSync(DIR);
    const mtimes = {};
    for (const name of names) {
      if (!name.endsWith('.webm')) continue;
      try {
        mtimes[name] = fs.statSync(path.join(DIR, name)).mtimeMs;
      } catch {
        // Renamed or removed between the listing and now.
      }
    }

    const { ready, waiting } = pendingRecordings({
      names,
      mtimes,
      since: state.since,
      tried: state.tried,
      now: Date.now(),
      settleMs: SETTLE_MS,
    });

    if (ready.length) {
      for (const stem of ready) {
        // Marked before running, not after: a crash mid-transcription must not
        // turn into an endless retry on every change to the folder.
        state.tried.push(stem);
        saveState(state);
        await transcribe(path.join(DIR, `${stem}.webm`), speakersFromSidecar(readSidecar(stem)));
      }
      continue;
    }
    if (waiting.length) {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      continue;
    }
    return;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
