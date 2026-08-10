// The command line, parsed once, in one place.
//
// This was inline in transcribe.js and silently wrong in two ways that both
// ended in a confusing failure rather than an error. A misspelled value flag —
// `--speakrs 3` — left `3` looking like a filename, so the tool reported "no
// such file: 3" and transcribed nothing. And `--language=es`, the form half the
// world types, matched nothing and installed auto-detect instead.
//
// So unknown flags are refused rather than ignored. A tool that quietly does
// something other than what was typed is worse than one that stops.

const VALUE_FLAGS = new Set(['--speakers', '--names', '--language']);
const BOOLEAN_FLAGS = new Set(['--force', '--no-prompt']);

export const KNOWN_FLAGS = [...VALUE_FLAGS, ...BOOLEAN_FLAGS].sort();

export const USAGE =
  'usage: transcribe.js [--force] [--language es] [--speakers N] [--names "A,B"]\n' +
  '                     [--no-prompt] <recording>...';

/**
 * Returns `{ files, force, noPrompt, language, speakers, names }`, or throws
 * with a message meant to be shown to a person.
 *
 * `speakers` is null when not given or not a positive integer — the caller then
 * asks, or falls back to auto-detection.
 *
 * A later occurrence of a flag wins, because the Quick Action bakes
 * `--language es` into its command ahead of everything Finder passes, and a
 * flag typed by hand has to be able to override it.
 */
export function parseArgs(argv) {
  const flags = new Map();
  const files = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith('--')) {
      files.push(arg);
      continue;
    }

    // Both spellings, so `--language=es` cannot silently do nothing.
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);

    if (BOOLEAN_FLAGS.has(name)) {
      if (eq !== -1) throw new Error(`${name} takes no value`);
      flags.set(name, true);
      continue;
    }

    if (!VALUE_FLAGS.has(name)) {
      throw new Error(`unknown option ${name}\n${USAGE}`);
    }

    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${name} needs a value\n${USAGE}`);
    }
    flags.set(name, value);
  }

  const speakers = Number(flags.get('--speakers'));

  return {
    files,
    force: flags.get('--force') === true,
    noPrompt: flags.get('--no-prompt') === true,
    language: flags.get('--language') ?? 'auto',
    speakers: Number.isInteger(speakers) && speakers > 0 ? speakers : null,
    names: String(flags.get('--names') ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean),
  };
}
