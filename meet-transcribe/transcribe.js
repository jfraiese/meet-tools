#!/usr/bin/env node
// Transcribe recordings. Invoked by the Finder Quick Action with the selected
// files as arguments, or by hand.
//
// Files are done one at a time on purpose: several selected recordings must not
// start several 3 GB models at once.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

import { parseVolumeStats, isTooQuiet, SILENCE_THRESHOLD_DB } from './lib/silence.js';
import { chooseRuntime, missingRuntimeMessage } from './lib/runtime.js';
import { parseWhisperSegments } from './lib/segments.js';
import {
  diarizeArgs,
  parseTurns,
  assignSpeakers,
  applyNames,
  formatText,
  formatSrt,
} from './lib/diarize.js';
import { paths as modelPaths, DIARIZER_PARTS } from './lib/models.js';
import { parseArgs, USAGE } from './lib/args.js';
import {
  probeArgs,
  normalizeArgs,
  transcribeCommand,
  outputPaths,
  durationArgs,
  parseDuration,
  parseDecodedDuration,
  durationSeconds,
  estimateMinutes,
} from './lib/audio.js';

const run = promisify(execFile);

function notify(message, title = 'Meet Transcribe') {
  const escape = (text) => String(text).replace(/["\\]/g, '\\$&');
  try {
    execFileSync('/usr/bin/osascript', [
      '-e',
      `display notification "${escape(message)}" with title "${escape(title)}"`,
    ]);
  } catch {
    // Notifications may be denied. Never let that stop a transcription.
  }
  console.log(message);
}

/**
 * Ask how many people spoke. A dialog rather than stdin, because the Finder
 * Quick Action has no terminal. Cancel, close, or 60 seconds of silence all
 * mean "auto-detect", which is then reported as untrustworthy rather than as
 * fact — measured, it finds 12-21 speakers in a 3-speaker call.
 *
 * Asked once for the whole selection. Naming the file only makes sense when
 * there is one; for a batch the count is being applied to all of them and the
 * dialog should say so rather than name the first and quietly mean the rest.
 */
function askSpeakerCount(count, firstName) {
  const name =
    count === 1 ? path.basename(firstName) : `these ${count} recordings`;
  const safe = name.replace(/["\\]/g, '');
  const script =
    `display dialog "How many people spoke in ${safe}?" ` +
    'default answer "3" with title "Meet Transcribe" ' +
    'buttons {"Auto-detect", "Label"} default button "Label" giving up after 60';
  try {
    const out = execFileSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8' });
    if (/button returned:Auto-detect|gave up:true/.test(out)) return null;
    const count = Number(/text returned:(\d+)/.exec(out)?.[1]);
    return Number.isInteger(count) && count > 0 ? count : null;
  } catch {
    return null; // cancelled, or no GUI available
  }
}

/** Is the diarization engine installed? Asked before the transcript exists, so
 *  the tool never opens a dialog for an answer it cannot use. */
const canDiarize = () => {
  const p = modelPaths();
  return DIARIZER_PARTS.every((part) => fileExists(p[part]));
};

/**
 * Speaker turns, or null.
 *
 * Null for every reason: not installed, or installed and failed. A transcript
 * that took a minute to produce must not be thrown away because the labelling
 * step exited non-zero — the caller writes the plain transcript when this
 * returns null, and that is the right outcome in both cases.
 */
async function diarize(wav, speakers) {
  const p = modelPaths();
  if (!canDiarize()) {
    notify('Speaker labels skipped — run install-diarizer.js to enable them');
    return null;
  }
  try {
    const { stdout } = await run(
      p.binary,
      diarizeArgs({
        wav,
        segmentationModel: p.segmentationModel,
        embeddingModel: p.embeddingModel,
        speakers,
      }),
      { env: { ...process.env, DYLD_LIBRARY_PATH: p.libDir }, maxBuffer: 16 * 1024 * 1024 },
    );
    return parseTurns(stdout);
  } catch (err) {
    notify(`Speaker labels skipped — the diarizer failed: ${firstLine(err.message)}`);
    return null;
  }
}

const firstLine = (text) => String(text ?? '').split('\n')[0].slice(0, 120);

const hasCommand = (name) => {
  try {
    execFileSync('/usr/bin/which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const fileExists = (candidate) => {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
};

/**
 * One decode, two answers: the volume statistics for the silence guard, and
 * the true duration for files whose container does not state one.
 */
async function measure(input) {
  let stderr = '';
  try {
    ({ stderr } = await run('ffmpeg', probeArgs(input)));
  } catch (err) {
    stderr = err.stderr ?? '';
  }
  return { stats: parseVolumeStats(stderr), decoded: parseDecodedDuration(stderr) };
}

/** Null for the recorder's own webm, which carries no duration header. */
async function probeDuration(input) {
  try {
    const { stdout } = await run('ffprobe', durationArgs(input));
    return parseDuration(stdout);
  } catch {
    return null;
  }
}

async function transcribeOne(source, runtime, { force, speakers, names, language }) {
  const { txt, srt, stem } = outputPaths(source);

  if (fileExists(txt) && !force) {
    // Name the file found, not just the stem: two sources that differ only by
    // extension — notes.m4a and notes.mp3 — map to the same transcript, and a
    // bare "already transcribed" makes that look like nothing happened.
    notify(`Skipped ${path.basename(source)} — ${path.basename(txt)} already exists`);
    return;
  }

  const { stats, decoded } = await measure(source);
  if (isTooQuiet(stats, SILENCE_THRESHOLD_DB) && !force) {
    notify(
      `${stem} is nearly silent (${stats.meanDb} dB) — skipped. Whisper invents dialogue on silence. Re-run with --force to override.`,
    );
    return;
  }

  const seconds = durationSeconds({ probed: await probeDuration(source), decoded });
  notify(
    seconds === null
      ? `Transcribing ${stem} — length unknown`
      : `Transcribing ${stem} — about ${estimateMinutes(seconds, runtime.kind)} min`,
  );

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'meet-transcribe-'));
  const wav = path.join(work, `${stem}.wav`);

  try {
    await run('ffmpeg', normalizeArgs(source, wav));

    // An enhancement: without the model the file still transcribes, just
    // without non-speech being stripped first.
    const vad = modelPaths().vadModel;
    const { command, args } = transcribeCommand(runtime, wav, work, {
      language,
      vadModel: fileExists(vad) ? vad : null,
    });
    await run(command, args, { maxBuffer: 64 * 1024 * 1024 });

    const json = path.join(work, `${stem}.json`);
    const segments = fileExists(json)
      ? parseWhisperSegments(JSON.parse(fs.readFileSync(json, 'utf8')))
      : [];

    const turns = segments.length ? await diarize(wav, speakers) : null;

    if (turns?.length) {
      const { labelled, mapping, unused } = applyNames(assignSpeakers(segments, turns), names);
      const found = new Set(turns.map((t) => t.speaker)).size;
      // A guessed count is never presented as fact.
      const heading =
        speakers === null
          ? `# Speaker count auto-detected as ${found}. Measured unreliable on this kind of audio — re-run with --speakers N.\n\n`
          : '';

      fs.writeFileSync(txt, heading + formatText(labelled));
      fs.writeFileSync(srt, formatSrt(labelled));
      fs.writeFileSync(
        path.join(path.dirname(txt), `${stem}.speakers.json`),
        JSON.stringify({ requested: speakers, found, turns, mapping, unused }, null, 2),
      );
      if (unused.length) notify(`More names than speakers — unused: ${unused.join(', ')}`);
      notify(`Transcript ready: ${stem}.txt (${found} speakers)`);
      return;
    }

    let saved = 0;
    for (const [ext, destination] of [
      ['txt', txt],
      ['srt', srt],
    ]) {
      const produced = path.join(work, `${stem}.${ext}`);
      if (fileExists(produced)) {
        fs.copyFileSync(produced, destination);
        saved += 1;
      }
    }

    if (saved === 0) throw new Error('the runtime produced no transcript');
    notify(`Transcript ready: ${stem}.txt`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const { files, force, noPrompt, language, speakers: speakersFlag, names } = options;

  if (files.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }

  const runtime = chooseRuntime({ hasCommand, fileExists, env: process.env });
  if (!runtime.kind) {
    notify(missingRuntimeMessage());
    process.exit(1);
  }

  // ffmpeg decodes, normalises and measures every file. Missing, it failed
  // once per recording with execFile's own ENOENT, which names a command the
  // person never typed.
  for (const command of ['ffmpeg', 'ffprobe']) {
    if (!hasCommand(command)) {
      notify(`${command} not found — install it with: brew install ffmpeg`);
      process.exit(1);
    }
  }

  // Asked once, not per file: the answer is a property of the meeting, and a
  // dialog per recording for a batch of five is not a question, it is a wall.
  const labelling = canDiarize();
  const speakers =
    speakersFlag ?? (labelling && !noPrompt ? askSpeakerCount(files.length, files[0]) : null);

  for (const file of files) {
    const source = path.resolve(file);
    try {
      if (!fileExists(source)) throw new Error('no such file');
      await transcribeOne(source, runtime, { force, speakers, names, language });
    } catch (err) {
      notify(`Failed on ${path.basename(source)}: ${err.message}`);
      // Keep going — one unreadable file must not abandon the rest — but do not
      // claim success afterwards.
      process.exitCode = 1;
    }
  }
}

await main();
