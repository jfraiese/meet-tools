# Meeting tools

Two small macOS tools that turn a Google Meet call into a searchable transcript.
They are independent — either works alone — but they are built to chain:

```
Google Meet call
   │   meet-recorder — a Chrome extension, records both sides
   ▼
~/Downloads/meet-recordings/2026-08-10-1403-weekly-sync-abc-defg-hij.webm
   │   meet-transcribe — a Finder Quick Action, runs Whisper
   ▼
… .txt  and  … .srt   beside the recording, optionally labelled by speaker
```

| | |
| --- | --- |
| [meet-recorder](meet-recorder/README.md) | Chrome extension. Records what you hear *and* what you say to one local file. |
| [meet-transcribe](meet-transcribe/README.md) | Finder Quick Action. Transcribes any audio file with Whisper. |

Node, no dependencies, no build step. macOS only.

---

## Before you record anyone

**Tell the room.** This tool gives the other participants no signal at all. Meet
does not announce that a third-party extension is capturing the tab, and the
extension posts nothing in the chat. Saying so is your job, and in many places —
including all-party-consent jurisdictions — it is also the law.

Nothing leaves your machine. The extension requests no network permission, so it
*cannot* upload a recording even if it wanted to; transcription runs a local
model. But "it stays on my disk" is not consent, and recordings of colleagues
are personal data: decide where they live and how long you keep them before you
start, not after.

## Getting set up

Roughly 20 minutes, most of it downloads.

**1. Prerequisites.**

```bash
brew install node ffmpeg whisper-cpp
```

**2. The Whisper model** — ~3 GB, the long one:

```bash
mkdir -p ~/.cache/whisper-cpp
curl -L -o ~/.cache/whisper-cpp/ggml-large-v3.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin
```

**3. The Quick Action**, with your usual meeting language:

```bash
node meet-transcribe/install.js --language es
```

**4. Speaker labels**, optional, ~210 MB:

```bash
node meet-transcribe/install-diarizer.js
```

**5. The recorder.** `chrome://extensions` → **Developer mode** → **Load
unpacked** → `meet-recorder/`. A setup tab opens once; grant microphone
access there.

macOS will prompt for a few permissions along the way — microphone for Chrome,
and notifications for the transcriber. Both are one-time, and declining
notifications only costs you the progress messages.

Then: join a Meet, press ⌘⇧U, and right-click the file it leaves in
`~/Downloads/meet-recordings/`.

Each tool's README covers its own details, failure modes and measured numbers.

## What gets downloaded

Nothing is bundled — the install scripts fetch the models and the diarizer
binary at setup time, into `~/.cache`. One of them, NVIDIA's TitaNet-large
speaker embedding model, is **CC-BY-4.0 and requires attribution** if you
publish speaker-labelled output. The rest are MIT or Apache 2.0.

See [THIRD-PARTY.md](THIRD-PARTY.md) for the full list.

## Tests

```bash
npm test                                          # from the repo root, both tools
node --test "meet-recorder/test/*.test.js"
node --test "meet-transcribe/test/*.test.js"
```

The globs need the quotes — a bare directory path is treated as a module by
recent Node versions and the command dies with a confusing stack trace.

## Contributing

The two rules that shape everything here: **no dependencies and no build step.**
`package.json` has no `dependencies` field and should not grow one — the tools
run straight from a checkout with the Node that is already on the machine, which
is what makes "clone it and run one command" true.

Comments explain *why*, usually citing a measurement or a platform failure that
cost a debugging session. If you change a behaviour that a comment justifies,
re-measure and update the number rather than deleting the note.

Pure logic lives in each tool's `lib/` and is covered by `node --test`. Anything
touching Chrome or Finder cannot honestly be unit-tested, and is covered by the
manual checklists in the two READMEs instead.

## Licence

MIT — see [LICENSE](LICENSE).
