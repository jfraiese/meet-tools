# Capturing Meet's DOM

Detection reads Google Meet's markup, which Google changes without notice and
which differs by locale. Everything in `meet-dom.json` came from a real call;
when detection breaks, this is how to replace it.

Run each snippet in the **Meet tab's** console (⌥⌘J), with the top frame
selected in the context dropdown — not an iframe. Each one copies its result to
the clipboard.

## Mic and participants

Run it **twice**: once unmuted, once muted. The pair is the point — the mic
button's label describes what pressing it will do, so the two states are what
tell "muted" from "live" apart.

```js
copy(JSON.stringify({
  micish: [...document.querySelectorAll('[aria-label]')]
    .map(e => e.getAttribute('aria-label'))
    .filter(l => /micro|mic\b|mute|silenc|sonido/i.test(l)),
  mutedAttrs: [...document.querySelectorAll('*')]
    .flatMap(e => [...e.attributes])
    .filter(a => /mut/i.test(a.name))
    .map(a => `${a.name}="${a.value}"`)
    .slice(0, 20),
  tiles: {
    moreOptions: document.querySelectorAll('[aria-label^="More options for "]').length,
    moreOptionsAny: document.querySelectorAll('[aria-label*="More options"]').length,
    videos: document.querySelectorAll('video').length,
    peopleButton: [...document.querySelectorAll('[aria-label]')]
      .map(e => e.getAttribute('aria-label'))
      .filter(l => /people|participant|personas|participante/i.test(l)),
  },
  frame: { isTop: window.top === window, labels: document.querySelectorAll('[aria-label]').length },
}, null, 2))
```

**Read the output before sharing it.** `micish` and `peopleButton` are safe;
anything derived from "More options for &lt;name&gt;" carries a colleague's name,
and `data-unresolved-meeting-id` carries the meeting id. Both are redacted in
the committed fixture and should stay that way.

`frame.isTop` must be `true`. If it is `false` you are in an iframe and the
counts mean nothing.

## Call state

The original capture, for `in-call` and `left`. Run once during a call and again
straight after leaving, then merge both into `meet-dom.json`.

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
