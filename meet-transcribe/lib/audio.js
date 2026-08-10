// The commands, and where their output goes.
//
// Normalisation is not a nicety. The same meeting audio, raw, clipped at
// 0.0 dB, was detected as English when it is Spanish, and transcribed as a page
// of "Thank you so much for joining us". Normalised, it detects Spanish and
// transcribes correctly. One filter fixes all three.

import path from 'node:path';

export const LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11';

// Duration is never guessed from file size. That heuristic assumed the
// recorder's nominal bitrate and was measured 24% wrong on a real recording —
// 5:53 against a true 7:17 — because opus does not sit at its nominal rate,
// and it broke outright once the recorder moved from 32 to 64 kbps.
//
// Two real sources replace it, in order of cost: ffprobe reads the container
// header instantly for any normal file, and for the recorder's own headerless
// webm the answer falls out of the volumedetect decode that already runs for
// the silence check.

/**
 * Measured on this machine (M5 Max), whole pipeline including normalisation:
 * openai-whisper 0.45x realtime on CPU, whisper.cpp 13x on Metal — 6m21s of
 * audio in 28.8s against roughly 16 minutes.
 *
 * The very first whisper.cpp run after installing is far slower (a 211s
 * outlier here) while the 2.9 GB model is read cold and Metal compiles its
 * pipelines. That is a one-off, so the estimate is not padded for it.
 */
const REALTIME_FACTOR = { 'openai-whisper': 0.45, 'whisper-cpp': 13 };

export const probeArgs = (input) => [
  '-hide_banner',
  '-i',
  input,
  '-af',
  'volumedetect',
  '-f',
  'null',
  '/dev/null',
];

export const normalizeArgs = (input, output) => [
  '-hide_banner',
  '-v',
  'error',
  '-y',
  '-i',
  input,
  '-af',
  LOUDNORM,
  '-ar',
  '16000',
  '-ac',
  '1',
  output,
];

/**
 * `language` is a code such as `es`, or `auto` to detect it.
 *
 * Detection is worth avoiding wherever the answer is already known. whisper.cpp
 * reads only the first 30 seconds and applies that answer to the whole file: 26
 * near-silent opening seconds were detected as Ukrainian at p = 0.40, and eleven
 * minutes of Spanish came out as Ukrainian.
 *
 * `vadModel` is null when the model is not installed. It is an enhancement, and
 * an enhancement may not turn a missing file into a failed transcription.
 *
 * There is deliberately no initial-prompt option. Whisper accepts one, and a
 * jargon list is the obvious use, but `-mc 0` below caps the carried context at
 * zero tokens and the prompt lives in that context — measured, `--prompt` with
 * `-mc 0` produces byte-identical output to no prompt at all, and whisper's own
 * counter reads `prompt time = 0.00 ms / 1 runs`. Raising the cap enough to let
 * it through (`-mc 16 --carry-initial-prompt`) does work, and then the prompt's
 * *style* transfers: a comma-separated word list produced a transcript with no
 * capitals and no sentence punctuation. Neither setting is worth having.
 */
export function transcribeCommand(runtime, wav, outDir, { language = 'auto', vadModel = null } = {}) {
  if (runtime.kind === 'whisper-cpp') {
    return {
      command: 'whisper-cli',
      args: [
        '-m',
        runtime.model,
        '-f',
        wav,
        '-otxt',
        '-osrt',
        // JSON carries machine-readable segment timings, which is what speaker
        // diarization merges against.
        '-oj',
        // Without this whisper.cpp defaults to English and silently returns
        // English text for Spanish audio. Observed, not theorised.
        '-l',
        language,
        // Never carry decoded text forward as context. The default (-1) let one
        // hallucinated opening segment become a whole-file repetition loop —
        // 302 identical lines where -mc 0 gives 144 lines of real dialogue on
        // the same audio. Forcing the right language does not fix it alone.
        '-mc',
        '0',
        // Stripping non-speech before the model sees it is the root fix for
        // hallucination; the -30 dB guard only ever caught whole dead files.
        ...(vadModel ? ['--vad', '-vm', vadModel] : []),
        '-of',
        path.join(outDir, path.parse(wav).name),
      ],
    };
  }
  return {
    command: 'whisper',
    // No --output_format: it takes a single value and defaults to every
    // format. No VAD arguments: openai-whisper has no such option.
    args: [
      wav,
      '--model',
      runtime.model,
      '--output_dir',
      outDir,
      '--verbose',
      'False',
      '--condition_on_previous_text',
      'False',
      // Its --language default is auto-detect, so the flag is added only when
      // there is an actual answer to give it.
      ...(language === 'auto' ? [] : ['--language', language]),
    ],
  };
}

export function outputPaths(source) {
  const dir = path.dirname(source);
  const stem = path.basename(source, path.extname(source));
  return { stem, txt: path.join(dir, `${stem}.txt`), srt: path.join(dir, `${stem}.srt`) };
}

/** Ask the container how long it is. */
export const durationArgs = (input) => [
  '-v',
  'error',
  '-show_entries',
  'format=duration',
  '-of',
  'default=noprint_wrappers=1:nokey=1',
  input,
];

/** ffprobe prints "N/A" for the recorder's own webm, and a number otherwise. */
export function parseDuration(stdout) {
  const seconds = Number(String(stdout ?? '').trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * ffmpeg's final progress line carries the real duration of what it decoded:
 *   size=N/A time=00:07:17.16 bitrate=N/A speed=1.12e+03x
 * This is how the recorder's own webm gets an exact length despite carrying no
 * duration header.
 */
export function parseDecodedDuration(stderr) {
  const found = [...String(stderr ?? '').matchAll(/time=(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/g)];
  if (!found.length) return null;
  const [, h, m, s, frac] = found[found.length - 1];
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${frac ?? 0}`);
  return seconds > 0 ? seconds : null;
}

/** The header if it has one, otherwise what the decode measured. Never a guess. */
export const durationSeconds = ({ probed, decoded }) => probed ?? decoded ?? null;

export const estimateMinutes = (seconds, kind) =>
  Math.max(1, Math.round(seconds / (REALTIME_FACTOR[kind] ?? 0.45) / 60));
