// Where the downloaded models and the diarizer binary live.
//
// This is a separate module from install-diarizer.js so that transcribe.js can
// ask where things are without importing a script whose top level deletes them.
// It previously imported the installer for this one function, which meant
// `transcribe.js --uninstall` — or any argv that happened to contain that word —
// wiped ~/.cache/sherpa-onnx at module load.
//
// ~/.cache rather than a package directory: a `brew upgrade` deletes anything
// kept under Homebrew's prefix, and these are 210 MB of downloads.

import os from 'node:os';
import path from 'node:path';

export const VERSION = 'v1.13.4';

// universal2 rather than osx-arm64: the same archive runs on Apple Silicon and
// on Intel, so there is no architecture to detect and no second code path to
// leave untested. Verified `lipo -archs` reports `x86_64 arm64`.
export const BUILD = `sherpa-onnx-${VERSION}-osx-universal2-shared`;

export const VAD_MODEL = 'ggml-silero-v5.1.2.bin';

export const ROOT = path.join(os.homedir(), '.cache', 'sherpa-onnx');

export const paths = () => ({
  root: ROOT,
  binary: path.join(ROOT, BUILD, 'bin', 'sherpa-onnx-offline-speaker-diarization'),
  libDir: path.join(ROOT, BUILD, 'lib'),
  segmentationModel: path.join(ROOT, 'sherpa-onnx-pyannote-segmentation-3-0', 'model.onnx'),
  embeddingModel: path.join(ROOT, 'nemo_en_titanet_large.onnx'),
  vadModel: path.join(ROOT, VAD_MODEL),
});

/**
 * Diarization needs all three; VAD is independent of it and deliberately not
 * included, so a missing VAD model never suppresses speaker labels.
 */
export const DIARIZER_PARTS = ['binary', 'segmentationModel', 'embeddingModel'];
