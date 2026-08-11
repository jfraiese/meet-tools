// The only place audio exists.
//
// Two constraints are wired in here rather than commented elsewhere:
//
//  - Capturing a tab mutes it for the user. `tabSource.connect(ctx.destination)`
//    is what gives the call back to your speakers. Remove that line and the
//    meeting goes silent for you while recording perfectly.
//  - Only the tab source is routed to the speakers. Routing the microphone
//    there too would play your own voice back at you.
//
// The stop path is ordered so that nothing about saving can prevent the next
// recording: teardown, then 'stopped', then the download. An earlier version
// awaited the download before reporting the stop, and a download that never
// reported completion wedged the whole extension.

import { recordingBasename, buildSidecar } from './lib/filename.js';
import { beginSession, appendChunk, clearSession, readSession } from './db.js';

const SILENCE_FLOOR = 0.004; // peak amplitude below this is "nothing is here"
const SILENCE_MS = 30000;
const SAMPLE_MS = 2000; // how often sampleLevels runs, and so what each sample is worth

let session = null;

function send(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function fail(name, message) {
  console.error(`[meet-recorder] ${name}: ${message}`);
  send({ type: 'error', name, message });
}

// A source that never rises above the silence floor is not being recorded,
// whatever the file size suggests. `activeMs` accumulates how long it did.
function makeMonitor(ctx, source) {
  const analyser = new AnalyserNode(ctx, { fftSize: 2048 });
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  return {
    lastActiveAt: Date.now(),
    activeMs: 0,
    peak() {
      analyser.getFloatTimeDomainData(buffer);
      let peak = 0;
      for (const sample of buffer) peak = Math.max(peak, Math.abs(sample));
      return peak;
    },
  };
}

/**
 * Both a live view for the banner and a running total for the sidecar.
 *
 * The sidecar used to carry a verdict — `sources: { mic: 'silent' }` — set by a
 * one-way latch that never reset. Thirty seconds of quiet while the other side
 * talks is not a broken microphone, it is listening, so on any real call both
 * sides latched and the field meant nothing. Two hour-long recordings arrived
 * saying both sources were dead when both were fine.
 *
 * A 30-second window cannot tell a dead source from someone letting a colleague
 * finish, so it no longer tries. What ships instead is the measurement itself —
 * how many seconds each source carried sound — which answers "why is my
 * transcript one-sided" without pretending to a diagnosis: 0 s is a dead
 * source, and 400 s against 900 s is a quiet participant.
 */
function sampleLevels() {
  if (!session) return;
  const now = Date.now();
  const status = {};
  for (const [name, monitor] of Object.entries(session.monitors)) {
    if (monitor.peak() > SILENCE_FLOOR) {
      monitor.lastActiveAt = now;
      monitor.activeMs += SAMPLE_MS;
    }
    status[name] = now - monitor.lastActiveAt > SILENCE_MS ? 'silent' : 'active';
  }
  send({ type: 'levels', ...status });
}

async function start({ streamId, meta }) {
  if (session) {
    // A recording is already live here and the worker has lost track of it.
    // Saying nothing would leave it stuck in 'arming' forever, with every
    // later press — stop included — silently inert.
    send({ type: 'started' });
    return;
  }

  // Capturing the tab mutes it, and only the `tabSource.connect` below gives it
  // back. So from here to that line, any failure has to hand the audio back
  // before it propagates — a denied microphone used to leave the user in a
  // silent meeting with no recording and no way to undo it but reloading.
  let tabStream = null;
  let micStream = null;
  let ctx = null;
  try {
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    });
    micStream = await navigator.mediaDevices.getUserMedia({
      // Echo cancellation matters when the call is on speakers: without it the
      // microphone re-records the other participants a few milliseconds late.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    ctx = new AudioContext();
  } catch (err) {
    for (const stream of [tabStream, micStream]) {
      stream?.getTracks().forEach((track) => track.stop());
    }
    await ctx?.close();
    throw err;
  }

  const tabSource = ctx.createMediaStreamSource(tabStream);
  const micSource = ctx.createMediaStreamSource(micStream);

  const mix = new GainNode(ctx, {
    // -6 dB of headroom. Two sources each near full scale sum past 0 dBFS and
    // clip, which two of the first four real recordings did. Loudness is put
    // back at transcription time by loudnorm — that is reversible, clipping is
    // not. Record quiet, normalise later.
    gain: 0.5,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  const destination = new MediaStreamAudioDestinationNode(ctx, {
    channelCount: 1,
    channelCountMode: 'explicit',
  });

  // Your side passes through a gate that Meet's mute button closes. Without it
  // the recording keeps your microphone whatever Meet is showing, because
  // getUserMedia is a separate capture that Meet cannot reach — so a muttered
  // aside nobody in the meeting heard would land in the file and the transcript.
  // Opens or closes according to what the page said before this started, not
  // after. A recording begun while already muted has no change to wait for.
  const micGain = new GainNode(ctx, { gain: meta.muted === true ? 0 : 1 });

  tabSource.connect(mix);
  micSource.connect(micGain);
  micGain.connect(mix);
  mix.connect(destination);

  tabSource.connect(ctx.destination); // un-mute the tab for the user

  // The mic monitor sits *after* the gate, so the meter shows what is being
  // recorded rather than what the microphone can hear. Muted reads as empty,
  // which is the honest answer to "is my side going in".
  const monitors = { mic: makeMonitor(ctx, micGain), tab: makeMonitor(ctx, tabSource) };

  const recorder = new MediaRecorder(destination.stream, {
    mimeType: 'audio/webm;codecs=opus',
    // 64 kbps, not 32. Whisper only needs phonemes and was perfectly happy at
    // 32, but speaker diarization depends on spectral detail that a bitrate
    // that low discards — clustering read the resulting noise as extra people,
    // finding 12-21 speakers in a 3-speaker call. An hour is ~29 MB instead of
    // ~14 MB, which buys back the detail for a cost nobody will notice.
    audioBitsPerSecond: 64000,
  });

  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (!event.data || event.data.size === 0) return;
    chunks.push(event.data);
    appendChunk(event.data).catch(() => {}); // best effort; never block recording
  };
  recorder.onerror = (event) => {
    fail('MediaRecorder', String(event.error?.message ?? event.error));
  };
  recorder.onstop = () => {
    finish().catch((err) => fail('Finish', err.message));
  };

  // Before `session` is set, and before beginSession clears the store: a stored
  // session means a recording that never reached disk, and starting the next
  // call is the most likely moment to walk over it without noticing. recover()
  // refuses while a recording is live, which is exactly why this runs here.
  await rescueOrphan();

  session = {
    ctx,
    recorder,
    chunks,
    meta,
    monitors,
    tabStream,
    micStream,
    micGain,
    startedAt: new Date(meta.startedAt),
    stopReason: 'manual',
    muted: meta.muted ?? null,
    participants: meta.participants ?? null,
    sampler: null,
  };

  await beginSession(meta);
  session.sampler = setInterval(sampleLevels, SAMPLE_MS);
  recorder.start(5000);
  send({ type: 'started' });
}

/**
 * Save anything a previous session left behind, before it is cleared.
 *
 * `recover()` is the same path the popup's button and the worker's start-up
 * both use, so a rescued recording is named and reported exactly like any other
 * recovery. Called before `session` is set, which is what lets it run at all —
 * it refuses while a recording is live.
 */
async function rescueOrphan() {
  try {
    await recover();
  } catch (err) {
    // Never block a new recording on rescuing an old one: the chunks stay in
    // IndexedDB either way and the popup's button is still there. Losing the
    // new meeting to save the last one would be the worse trade.
    console.warn('[meet-recorder] could not rescue previous recording:', err.message);
  }
}

function stop(stopReason) {
  if (!session) {
    // Nothing to stop, but the worker is waiting to hear that it stopped.
    send({ type: 'stopped' });
    return;
  }
  session.stopReason = stopReason;
  if (session.recorder.state !== 'inactive') session.recorder.stop();
  else finish().catch((err) => fail('Finish', err.message));
}

async function finish() {
  if (!session) return;
  const s = session;
  session = null;
  clearInterval(s.sampler);

  for (const stream of [s.tabStream, s.micStream]) {
    for (const track of stream.getTracks()) track.stop();
  }
  await s.ctx.close().catch(() => {});

  // Before saving, not after. Whether the download works has nothing to do
  // with whether the next recording may start.
  send({ type: 'stopped' });

  const endedAt = new Date();
  const callCode = s.meta.callCode ?? 'meet';
  const basename = recordingBasename({
    startedAt: s.startedAt,
    tabTitle: s.meta.tabTitle,
    callCode,
  });
  const sidecar = buildSidecar({
    startedAt: s.startedAt,
    endedAt,
    callCode,
    tabTitle: s.meta.tabTitle,
    stopReason: s.stopReason,
    participants: s.participants,
    sources: {
      micActiveMs: s.monitors.mic.activeMs,
      tabActiveMs: s.monitors.tab.activeMs,
    },
  });

  const saved = await saveFile(
    new Blob(s.chunks, { type: 'audio/webm' }),
    `meet-recordings/${basename}.webm`,
  );
  await saveFile(
    new Blob([JSON.stringify(sidecar, null, 2)], { type: 'application/json' }),
    `meet-recordings/${basename}.json`,
  );

  // Only once the audio is genuinely on disk. Clearing after a failed download
  // would destroy the very copy the recovery path exists to hand back.
  if (saved) {
    await clearSession();
    send({ type: 'saved', filename: `${basename}.webm` });
  } else {
    fail('Download', 'the recording could not be saved — recover it from the extension popup');
  }
}

/**
 * Hand the file to the service worker to download, and resolve with whether it
 * reached disk.
 *
 * This indirection is not a style choice. Per Chrome's documentation, "the
 * runtime API is the only extensions API supported by offscreen documents" —
 * `chrome.downloads` simply does not exist in here, and calling it was a silent
 * no-op that produced no file and no error and no entry in download history.
 *
 * What this document *can* do is mint the blob URL. Blob URLs are scoped to the
 * extension origin, which the worker shares, so it can download from one. The
 * URL is revoked late, because revoking it before Chrome has finished reading
 * the blob interrupts the download.
 */
async function saveFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const response = await chrome.runtime.sendMessage({ type: 'download', url, filename });
    if (!response?.ok) fail('Download', response?.error ?? 'the worker could not save the file');
    return Boolean(response?.ok);
  } catch (err) {
    fail('Download', err.message);
    return false;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

/** Save chunks left behind by a recording that never completed its own save. */
async function recover() {
  // Never while recording: the chunks in storage would be the live one's, and
  // clearing them afterwards would delete the start of it. Say so — refusing
  // in silence is indistinguishable from a broken button.
  if (session) {
    fail('Recover', 'a recording is still running here — stop it first');
    return false;
  }
  const orphan = await readSession().catch(() => null);
  if (!orphan || orphan.chunks.length === 0) return false;

  const callCode = orphan.meta.callCode ?? 'meet';
  const basename = recordingBasename({
    startedAt: new Date(orphan.meta.startedAt),
    tabTitle: orphan.meta.tabTitle,
    callCode,
  });
  const saved = await saveFile(
    new Blob(orphan.chunks, { type: 'audio/webm' }),
    `meet-recordings/${basename}-recovered.webm`,
  );
  if (saved) {
    await clearSession();
    send({ type: 'saved', filename: `${basename}-recovered.webm` });
  }
  return saved;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;

  // 'ping' answers whether a recording is genuinely live here, which is how the
  // worker tells a real recording from a stale state left by a dead document.
  // `startedAt` rides along because this document is the only thing that knows
  // when the recording actually began — the worker's copy is a label, this is
  // the fact, and the popup's timer has to agree with the file that lands.
  if (msg.type === 'ping') {
    sendResponse({
      ok: true,
      recording: Boolean(session),
      startedAt: session ? session.startedAt.getTime() : null,
    });
    return false;
  }

  // Live meter levels. Polled by the popup only while it is open — a few
  // seconds at a time — rather than pushed continuously to a listener that is
  // usually not there.
  if (msg.type === 'levels-now') {
    sendResponse({
      ok: true,
      recording: Boolean(session),
      startedAt: session ? session.startedAt.getTime() : null,
      mic: session ? session.monitors.mic.peak() : 0,
      tab: session ? session.monitors.tab.peak() : 0,
      muted: session ? session.muted : false,
      participants: session ? session.participants : null,
    });
    return false;
  }

  // Meet's mute, applied to the recording. Gating the gain rather than stopping
  // the track: a stopped MediaStreamTrack cannot be restarted, so unmuting
  // would need the whole graph rebuilt mid-recording.
  if (msg.type === 'mic-state') {
    if (session) {
      session.muted = msg.muted; // true | false | null ("could not tell")
      // Only an actual `true` closes the gate. Unknown keeps your side
      // recording, on purpose.
      session.micGain.gain.value = msg.muted === true ? 0 : 1;
      // The highest count seen: people arrive late, and the number that helps
      // when transcribing is how many were ever in the room.
      if (msg.participants > (session.participants ?? 0)) session.participants = msg.participants;
    }
    sendResponse({ ok: true, recording: Boolean(session) });
    return false;
  }

  // Acknowledge immediately: the sender retries until it hears back, because
  // createDocument() resolves before this listener is registered.
  sendResponse({ ok: true, recording: Boolean(session) });

  if (msg.type === 'start') {
    start(msg).catch((err) => {
      session = null;
      fail(err.name, err.message);
    });
  }
  if (msg.type === 'stop') stop(msg.stopReason);
  if (msg.type === 'recover') recover().catch((err) => fail('Recover', err.message));
  return false;
});
