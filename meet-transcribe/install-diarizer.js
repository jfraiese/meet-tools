#!/usr/bin/env node
// Fetch the speaker diarization engine.
//
// Three things here are not optional. macOS on Apple Silicon SIGKILLs unsigned
// downloaded arm64 binaries with no message whatsoever — the first attempt
// exited 137 having printed nothing — so the binary and its bundled dylib are
// ad-hoc signed. The binary is the shared build, so it needs DYLD_LIBRARY_PATH
// at run time. And everything lands in ~/.cache rather than a package
// directory an upgrade would delete.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { paths, ROOT, VERSION, BUILD, VAD_MODEL } from './lib/models.js';

const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

const DOWNLOADS = [
  {
    // The universal2 build, so this works on Intel Macs too. The arm64-only
    // archive was here first and would have downloaded 57 MB and installed
    // cleanly on an Intel machine before dying at the first transcription.
    name: 'binary',
    url: `${RELEASE}/${VERSION}/${BUILD}.tar.bz2`,
    archive: true,
  },
  {
    name: 'segmentation model',
    url: `${RELEASE}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`,
    archive: true,
  },
  {
    name: 'embedding model',
    url: `${RELEASE}/speaker-recongition-models/nemo_en_titanet_large.onnx`,
    archive: false,
    file: 'nemo_en_titanet_large.onnx',
  },
  {
    // Voice activity detection for whisper.cpp — unrelated to diarization, but
    // it lands here because this is already the script that fetches models into
    // ~/.cache. 865 KB, and it is data rather than an executable, so unlike the
    // diarizer binary it needs no ad-hoc signature.
    name: 'VAD model',
    url: `https://huggingface.co/ggml-org/whisper-vad/resolve/main/${VAD_MODEL}`,
    archive: false,
    file: VAD_MODEL,
  },
];

function fetchAll() {
  fs.mkdirSync(ROOT, { recursive: true });
  for (const item of DOWNLOADS) {
    console.log(`Fetching ${item.name}…`);
    if (item.archive) {
      const tmp = path.join(ROOT, 'download.tar.bz2');
      execFileSync('/usr/bin/curl', ['-fL', '--progress-bar', '-o', tmp, item.url], {
        stdio: 'inherit',
      });
      execFileSync('/usr/bin/tar', ['xjf', tmp, '-C', ROOT]);
      fs.rmSync(tmp);
    } else {
      execFileSync(
        '/usr/bin/curl',
        ['-fL', '--progress-bar', '-o', path.join(ROOT, item.file), item.url],
        { stdio: 'inherit' },
      );
    }
  }
}

function sign() {
  const { binary, libDir } = paths();
  // Unsigned downloaded binaries are killed on sight, silently. Sign the dylibs
  // too: the loader rejects the process if anything it loads is unsigned.
  const targets = fs
    .readdirSync(libDir)
    .map((f) => path.join(libDir, f))
    .filter((f) => fs.statSync(f).isFile());
  for (const target of [...targets, binary]) {
    execFileSync('/usr/bin/codesign', ['-s', '-', '--force', target], { stdio: 'ignore' });
  }
}

function verify() {
  const p = paths();
  for (const [what, where] of Object.entries(p)) {
    if (where !== p.root && where !== p.libDir && !fs.existsSync(where)) {
      throw new Error(`${what} missing after install: ${where}`);
    }
  }
  // Running it with no arguments must produce its usage text. Silence with
  // exit 137 here means the signature did not take, which is the failure this
  // whole function exists to catch.
  let output = '';
  try {
    output = execFileSync(p.binary, [], {
      env: { ...process.env, DYLD_LIBRARY_PATH: p.libDir },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (err.signal === 'SIGKILL' || err.status === 137) {
      throw new Error('the binary was killed on launch — ad-hoc signing did not take');
    }
  }
  if (!/speaker diarization/i.test(output)) {
    throw new Error('the binary ran but did not identify itself');
  }
  console.log('Verified: the diarizer runs.');
}

// Both branches are gated on being run directly. Only the install branch was,
// once, which meant any process that imported this file with `--uninstall`
// anywhere in its argv deleted 210 MB of models at module load.
const runDirectly = process.argv[1]?.endsWith('install-diarizer.js');

if (runDirectly && process.argv.includes('--uninstall')) {
  fs.rmSync(ROOT, { recursive: true, force: true });
  console.log(`Removed ${ROOT}`);
} else if (runDirectly) {
  fetchAll();
  sign();
  verify();
  console.log(`Installed into ${ROOT}`);
}
