# Meet Recorder

Records a Google Meet call — both what you hear and what you say — to one file
in `~/Downloads/meet-recordings/`, for transcribing with Whisper afterwards.

Chrome extension, no dependencies, no build step. It requests no network
permission, so it cannot upload a recording.

**Tell the room you are recording.** The other participants get no signal from
Meet or from this extension. See [the note in `../README.md`](../README.md).

## Install

Requires Chrome 116 or newer.

1. `chrome://extensions` → **Developer mode** → **Load unpacked** →
   `meet-recorder/`.
2. A setup tab opens once. Grant microphone access — Chrome only allows that
   prompt from a real tab, which is the whole reason that page exists.
3. Check the shortcut at `chrome://extensions/shortcuts`. Default `⌘⇧U`.

Loading unpacked means Chrome will show a "Disable developer mode extensions"
warning on each restart. That is expected for an extension not shipped through
the Web Store; dismiss it.

## Use

Join a Meet. A banner appears reading **Record this meeting — ⌘⇧U**, with a
Record button. The button usually works, but it is not guaranteed: Chrome grants
tab capture only once the extension itself has been invoked, and a click inside
the page does not count as that gesture. When it is refused the banner says so,
and the shortcut — or the toolbar popup — always works.

Recording stops — and saves — when you leave the call, close the tab, press the
shortcut again, or hit **Stop and save** in the popup. The banner turns green
with the filename once the file is on disk.

Saving never blocks the next recording. The stop path reports itself finished
before it downloads, so a download that fails or stalls cannot leave the
extension stuck in "Recording" — an earlier version did exactly that, and the
only way out was the recovery button.

If a recording never reaches disk, its chunks stay in IndexedDB and the
extension **saves them by itself** the next time its service worker starts,
appending `-recovered` to the name. The popup's recovery button is the fallback
for when even that fails, not the normal way recordings arrive.

Two files land per meeting:

```
2026-08-10-1403-weekly-sync-abc-defg-hij.webm
2026-08-10-1403-weekly-sync-abc-defg-hij.json
```

The `.json` records duration, the call code, why recording stopped, and how many
milliseconds each source carried sound:

```json
"sources": { "micActiveMs": 412000, "tabActiveMs": 2380000 }
```

Check it if a transcript comes out one-sided. A `0` is a dead source; a small
number is a participant who mostly listened. This deliberately reports the
measurement rather than a verdict — an earlier version tried to say whether each
source "worked", and could not tell a broken microphone from someone letting a
colleague finish.

Then, when you want the text, right-click the `.webm` in Finder →
**Quick Actions → Transcribe with Whisper**. See
[meet-transcribe](../meet-transcribe/README.md) — it normalises the audio first,
which is load-bearing rather than cosmetic, so prefer it over calling `whisper`
on these files by hand.

## Recording other people

This tool gives the other participants no signal at all. Meet does not tell
them a third-party extension is capturing the tab, and this build posts nothing
in the chat — that is deferred to phase 2. Telling the room is your job, and in
some places it is also the law.

## Tests

```bash
npm test                                        # from the repo root, runs these too
node --test "meet-recorder/test/*.test.js" # just this tool
```

`lib/` is covered by `node --test`. Everything touching Chrome is covered by
the checklist below, because it cannot honestly be covered any other way.

### Manual checklist

Run against a real two-participant call after any change to `content.js`,
`background.js`, or `offscreen.js`.

- [ ] The Meet landing page shows no banner.
- [ ] Joining a call shows the banner within a second.
- [ ] `⌘⇧U` starts recording, and **the call stays audible**.
- [ ] Counting test: they count to five, then you count to five. Both are
      audible in the saved file. This is the one that matters — a graph that
      drops a source still produces a file that plays.
- [ ] Leaving the call saves two files with no further action.
- [ ] Closing the tab mid-call saves a file with `stopReason: "tab-closed"`.
- [ ] Muting yourself for 30 s while they talk turns the banner amber and shows
      `You: silent` in the popup — and it turns back once you speak again.
- [ ] `killall -9 "Google Chrome"` mid-recording, then reopening, offers
      **Recover last recording**, and the recovered file plays.

### The fragile part

Detection reads Meet's DOM, which Google changes without notice, and the
`aria-label` selectors are locale-dependent.

`test/fixtures/meet-dom.json` holds attributes captured from a real call — one
snapshot during it, one right after leaving — and `test/fixtures.test.js`
checks the selectors against both. It asserts more than "something matched":
that no in-call marker survives into the ended page, and no ended marker
appears during the call. That is the bug it exists for. `data-call-ended`
was originally listed as an *in-call* marker, so a finished meeting read as a
live one and nothing ever stopped by itself.

`data-in-call="true"` is set in **both** states. It is the obvious signal and
it is wrong; a test pins that so nobody reaches for it again.

To refresh, run this in the page console during a call, then again after
leaving, and merge both into the fixture:

```js
copy(JSON.stringify({
  videos: document.querySelectorAll('video').length,
  dataAttrs: [...new Set([...document.querySelectorAll('*')]
    .flatMap(e => [...e.attributes]
      .filter(a => a.name.startsWith('data-') && a.value.length < 40)
      .map(a => `${a.name}="${a.value}"`)))].slice(0, 60),
  ariaLabels: [...new Set([...document.querySelectorAll('[aria-label]')]
    .map(e => e.getAttribute('aria-label')))].slice(0, 50)
}, null, 2))
```

Read it before committing — `ariaLabels` carries participant names and the
meeting id shows up in `data-unresolved-meeting-id`. Both are redacted in the
committed fixture.

If detection breaks entirely, the shortcut still works: the banner is a
convenience, not the mechanism.

## Shape

```
manifest.json   MV3: tabCapture, offscreen, downloads, storage, activeTab
background.js   service worker — shortcut, stream id, offscreen lifecycle, badge
content.js      injected on meet.google.com — call detection, banner
offscreen.js    the only place audio exists — graph, recorder, levels, download
popup.js        status, stop, crash recovery
setup.js        one-time microphone grant
db.js           IndexedDB chunk store, so a crash costs seconds not the meeting
lib/            pure, no chrome.* — the only part node --test can reach
```

Four constraints in the code are Chrome's, not choices, and each is commented
where it lives:

- **`chrome.runtime` is the only extensions API an offscreen document may use.**
  So the document that holds the audio cannot save it: it mints a blob URL and
  the service worker downloads from it. Calling `chrome.downloads` in there
  fails silently — no file, no error, no entry in Chrome's download history —
  which is exactly how this was built wrong the first time.

- The offscreen document's reason is `USER_MEDIA`, never `AUDIO_PLAYBACK` —
  the latter self-closes after 30 s of silence and would end a recording during
  a pause.
- `tabSource.connect(ctx.destination)` in `offscreen.js` is what keeps the call
  audible: capturing a tab mutes it for you.
- Capture may only begin from a gesture Chrome recognises — a `commands`
  shortcut or a toolbar click. The banner's button works once the extension has
  been invoked in that session, and is refused before then, which is why the
  banner names the shortcut alongside the button rather than relying on it.
