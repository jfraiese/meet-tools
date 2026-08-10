# Meet Transcribe

Right-click any audio file in Finder → **Quick Actions → Transcribe with
Whisper**. A `.txt` and `.srt` appear beside it, optionally labelled by speaker.

Node, no dependencies, no build step. Everything runs on your machine; nothing
is uploaded.

---

## Requirements

| | |
| --- | --- |
| macOS | 13+. Apple Silicon or Intel — the diarizer ships a universal binary. |
| Node | 20.11+ (`node --version`). `brew install node`. |
| ffmpeg | Required, not optional. `brew install ffmpeg` — brings `ffprobe` too. |
| Whisper | One of the two below. |
| Disk | ~3 GB for the Whisper model, ~210 MB more if you want speaker labels. |

Transcription is much faster on Apple Silicon, where whisper.cpp uses Metal.
Intel Macs work but fall back to CPU — expect roughly 0.45× realtime, so an
hour-long meeting takes over two hours.

## Install

**1. ffmpeg and a Whisper.** whisper.cpp is strongly preferred — measured 13×
realtime against 0.45× for openai-whisper on the same file:

```bash
brew install ffmpeg whisper-cpp
mkdir -p ~/.cache/whisper-cpp
curl -L -o ~/.cache/whisper-cpp/ggml-large-v3.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin
```

That download is ~3 GB and takes a while. `~/.cache/whisper-cpp` rather than
`/opt/homebrew/share/whisper-cpp` on purpose: Homebrew's directory is a symlink
into the Cellar, so a `brew upgrade` deletes a 3 GB model kept there.

The alternative is `pipx install openai-whisper`, which fetches its own model on
first run but pulls ~2.5 GB of PyTorch and never touches the GPU.

**2. The Quick Action.**

```bash
node meet-transcribe/install.js --language es   # or your language
node meet-transcribe/install.js                 # ... or auto-detect
node meet-transcribe/install.js --uninstall
```

**Set `--language` if your meetings are always in one language.** Whisper reads
only the first 30 seconds to decide, then applies that answer to the whole file.
A call that opens with silence gets a coin flip: 26 near-silent opening seconds
were detected as Ukrainian at p = 0.40, and eleven minutes of Spanish came out
as Ukrainian.

The bundle embeds this checkout's path, the language, and the directories the
tools live in — so moving the repo or changing language means re-running this.

**3. Speaker labels (optional).**

```bash
node meet-transcribe/install-diarizer.js   # ~210 MB, no HuggingFace account
```

Without this, transcripts are still produced — just unlabelled.

If the menu item does not appear, log out and back in; the Services cache is
stubborn.

## Use

Right-click a recording in Finder, or run it directly:

```
transcribe.js [--force] [--language es] [--speakers N] [--names "A,B"]
              [--no-prompt] <recording>...
```

```bash
node meet-transcribe/transcribe.js recording.webm
node meet-transcribe/transcribe.js meeting.m4a voicememo.mp3
node meet-transcribe/transcribe.js --force quiet-recording.webm
node meet-transcribe/transcribe.js --language pt --speakers 3 call.m4a
```

A flag typed here beats the one baked into the Quick Action, so a single
Portuguese recording needs no reinstall.

`--no-prompt` suppresses the speaker-count dialog, for scripting.

### What it accepts

Anything ffmpeg can decode — `.m4a`, `.mp3`, `.wav`, `.aiff`, `.mov`, `.mp4`,
and the recorder's `.webm`. Verified on m4a and mp3 as well as webm.

The Quick Action is registered for `public.audio` and `public.movie`, and macOS
conformance does the rest: an `.m4a` types as `com.apple.m4a-audio`, which
conforms to `public.audio`, so the menu item appears on it.

**Transcripts are named after the source without its extension**, so
`interview.m4a` and `interview.mp3` in one folder both want `interview.txt`. The
second is skipped, and says so by name rather than silently.

## Speakers

```bash
node meet-transcribe/transcribe.js --speakers 3 --names "Ada,Bo,Cy" meeting.webm
```

Adds `SPEAKER_00:`-style prefixes to the `.txt` and `.srt`, and writes a
`<stem>.speakers.json` holding the raw turns and the name mapping — so
relabelling later never means re-running a diarization pass.

Costs about 48 s per 7 minutes of audio, on top of transcription.

**You have to say how many people spoke.** Auto-detection never converges: on a
3-speaker recording it found 21 speakers at threshold 0.80, 18 at 0.90, 13 at
0.95 and still 12 at 0.99. So `--speakers N`, or a dialog appears; skipping
falls back to auto-detection with the result marked untrustworthy in the
transcript itself.

Recording at a higher bitrate does not help. On a two-speaker call, 64 kbps gave
12/8/7/5 clusters across those thresholds against 12/7/6/6 for the identical
audio at 32 kbps.

**Names are positional and are a guess until you check them.** `--names` maps in
order of first appearance, which is the only ordering the tool can know — it has
no idea who anyone is. Read the first few lines and reorder if they are wrong;
`speakers.json` records the mapping that was used.

### What speaker labels cannot do

**Telling it the count does not make the labels right.** It returns the number
of clusters you ask for, which is a different thing. On a two-speaker call the
split was 97.3% / 2.7% between people who visibly trade questions. The collapse
is in the whole-file clustering rather than the audio — the same diarizer on a
60-second excerpt splits that window about 78/22. Unresolved; treat labels as a
draft.

Whisper's segments are also coarser than the diarizer's turns: a four-second
segment can contain two speakers, and labels apply to whole segments. A
half-second interjection inside someone else's sentence is unrepresentable
whatever the merge rule does. Overlapping speech degrades clustering further,
which is inherent to the approach.

## What it does, and why

```
recording.webm
   │  ffmpeg -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 16000 -ac 1
   ▼
/tmp/x.wav ──▶ whisper-cli | whisper ──▶ recording.txt + recording.srt
```

**Normalisation is the load-bearing step, not a nicety.** The same meeting, raw
versus normalised:

| | raw | normalised |
| --- | --- | --- |
| volume | −21.4 dB mean, **0.0 dB max** (clipped) | −17.0 dB mean, −1.4 dB max |
| detected language | English — wrong | Spanish — right |
| transcript | 146 chars for 110 s, "Thank you so much for joining us" repeated | 1026 chars for 90 s, coherent |

One filter fixes clipping, language detection, and hallucination together.

**Decoded text is never carried forward as context** (`-mc 0`). Whisper's
default feeds each segment's output into the next, so one bad opening poisons
everything after it: a hallucinated first segment became 302 identical lines
where the same audio with `-mc 0` gives 118 lines of real dialogue.

**Non-speech is stripped before Whisper sees it** (`--vad`), when the VAD model
is installed. This is the root fix for hallucination — it cannot invent dialogue
over silence it never receives. It also made the same file 30% faster. It is not
free: one line the non-VAD run got right came back garbled.

**There is no jargon prompt, deliberately.** Whisper accepts an initial prompt
and a word list is the obvious use. It was built, measured and removed: with
`-mc 0` the prompt never reaches the decoder at all (`prompt time = 0.00 ms /
1 runs`, byte-identical output), and raising the cap until it does lets the
prompt's *style* transfer — a comma-separated list produced a transcript with no
capitals and no sentence punctuation.

**Near-silent files are skipped.** Below −30 dB mean, Whisper invents dialogue
rather than returning nothing. The threshold is calibrated against four real
recordings: −21.4 and −24.2 transcribed well, −34.9 hallucinated, −48.5 was
empty. `--force` overrides.

**The silence probe reads the original file, not the normalised one.**
`loudnorm` lifts everything to −16 LUFS, so a guard placed after it could never
fire.

**Duration is never estimated from file size.** That heuristic was measured 24%
wrong on a real recording, reading 5:53 for a file that is 7:17, because opus
does not sit at its nominal bitrate. Length comes from `ffprobe`, or — for the
recorder's headerless webm — from ffmpeg's final progress line during the volume
check that already runs.

### Does normalisation hurt diarization?

A fair worry, since `loudnorm` applies dynamic gain and speaker embeddings key
on timbre. Measured on a 3-speaker recording, by how many speakers clustering
found — closer to 3 is better:

| variant | speakers found |
| --- | --- |
| `loudnorm` | **13** |
| linear gain only | 15 |
| no normalisation | 16 |

It helps rather than hurts, so it stays. All three are far from 3, which points
at the clustering rather than the filter.

## Speed

Both runtimes on the same 6m21s meeting, whole pipeline including normalisation:

| runtime | time | throughput |
| --- | --- | --- |
| whisper.cpp on Metal | **28.8 s** | 13× realtime |
| openai-whisper on CPU | ~16 min | 0.45× realtime |

whisper.cpp also produced better text — capitalised and punctuated, where
openai-whisper returned lowercase run-ons.

**The first whisper.cpp run after installing is much slower** — 211 s here —
while the 3 GB model is read cold and Metal compiles its shader pipelines. That
is a one-off.

## When something goes wrong

Each of these failed silently at least once, which is why they are listed.

**"No Whisper found", but `whisper-cli` works in your terminal.** A Quick Action
runs with `PATH=/usr/bin:/bin:/usr/sbin:/sbin` and nothing else — Homebrew and
pipx are both invisible to it. The installed bundle exports a PATH to fix this;
if you are debugging one, run what it actually runs:

```bash
CMD=$(plutil -extract 'actions.0.action.ActionParameters.COMMAND_STRING' raw -o - \
  ~/Library/Services/"Transcribe with Whisper.workflow"/Contents/document.wflow)
env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -c "$CMD" recording.webm
```

**The menu item does not appear.** Log out and back in. `install.js` flushes the
Services cache, but macOS does not always listen.

**The transcript is in the wrong language.** Detection reads the first 30
seconds only. Re-run with `--language`.

**Nothing happens and there is no error.** A Quick Action has no terminal, so a
crash before the first notification is invisible. Run the same file through
`transcribe.js` directly to see the message.

**Speaker labels are missing.** Run `install-diarizer.js`. If it was already
installed, the diarizer failed — the transcript is still written, and the
notification says which.

## Tests

```bash
npm test                                             # from the repo root
node --test "meet-transcribe/test/*.test.js"   # just this tool
```

`lib/` is covered, including `plutil -lint` over the generated plists — a
malformed plist produces no error and no menu item, so it has to be caught here.

### Manual checklist

- [ ] `install.js` prints a path and no lint error.
- [ ] Right-clicking a `.webm` in Finder shows **Transcribe with Whisper**.
- [ ] Running it notifies at start with an estimate, and again when done.
- [ ] `.txt` and `.srt` land beside the `.webm`.
- [ ] A second run says "Already transcribed" immediately.
- [ ] A near-silent recording is skipped with its measured level in the message.
- [ ] `--uninstall` removes the menu item.

## Out of scope

Turning transcripts into tasks, or any handoff into a downstream tool. This
writes files next to your recording and stops there.

## What it downloads

See [`../README.md`](../README.md) for the licences of the models and binaries
this fetches.
