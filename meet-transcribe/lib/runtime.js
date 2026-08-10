// Which Whisper to run.
//
// whisper.cpp is preferred: openai-whisper measured 0.45x realtime here and
// warned "FP16 is not supported on CPU", so PyTorch never touched the GPU.
// whisper.cpp with Metal is several times faster on this hardware.
//
// But brew installs the binary without any model, and whisper-cli with no
// model fails once per file with an unhelpful message. So the question is not
// "is it installed" but "is it installed and able to run", and the answer falls
// back rather than failing.

export const MODEL_FILE = 'ggml-large-v3.bin';

// ~/.cache first, deliberately. Homebrew's /opt/homebrew/share/whisper-cpp is a
// symlink into Cellar/whisper-cpp/<version>/, so a `brew upgrade` deletes
// anything kept there — including a 3 GB model. The cache directory survives.
export const MODEL_DIRS = [
  `${process.env.HOME ?? ''}/.cache/whisper-cpp`,
  '/opt/homebrew/share/whisper-cpp',
  '/usr/local/share/whisper-cpp',
  `${process.env.HOME ?? ''}/Library/Application Support/whisper-cpp`,
];

export function findGgmlModel({ fileExists, env = {} }) {
  if (env.WHISPER_MODEL && fileExists(env.WHISPER_MODEL)) return env.WHISPER_MODEL;
  for (const dir of MODEL_DIRS) {
    const candidate = `${dir}/${MODEL_FILE}`;
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

export function chooseRuntime({ hasCommand, fileExists, env = {} }) {
  if (hasCommand('whisper-cli')) {
    const model = findGgmlModel({ fileExists, env });
    if (model) return { kind: 'whisper-cpp', model };
  }
  if (hasCommand('whisper')) return { kind: 'openai-whisper', model: 'large-v3' };
  return { kind: null, model: null };
}

// Both costs stated, because this is the message someone reads at the moment
// they choose. "No extra download" was here and was wrong twice over: pipx
// install openai-whisper pulls PyTorch, and the model is fetched on first run.
export const missingRuntimeMessage = () =>
  'No Whisper found. Either: brew install whisper-cpp and download ggml-large-v3.bin ' +
  '(~3 GB) into ~/.cache/whisper-cpp — 13x realtime on Metal. ' +
  'Or pipx install openai-whisper — no model to fetch by hand, but ~2.5 GB of PyTorch ' +
  'and 0.45x realtime on CPU.';
