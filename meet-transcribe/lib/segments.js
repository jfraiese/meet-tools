// One segment shape, from either runtime.
//
// openai-whisper writes `segments` with seconds; whisper.cpp writes
// `transcription` with millisecond `offsets`. Diarization merges on time, so a
// missed unit conversion would misplace every label by a factor of a thousand.

const clean = (text) => String(text ?? '').trim();

export function parseWhisperSegments(json) {
  if (!json || typeof json !== 'object') return [];

  if (Array.isArray(json.segments)) {
    return json.segments
      .map((s) => ({ start: Number(s.start), end: Number(s.end), text: clean(s.text) }))
      .filter((s) => s.text && Number.isFinite(s.start) && Number.isFinite(s.end));
  }

  if (Array.isArray(json.transcription)) {
    return json.transcription
      .map((s) => ({
        start: Number(s.offsets?.from) / 1000,
        end: Number(s.offsets?.to) / 1000,
        text: clean(s.text),
      }))
      .filter((s) => s.text && Number.isFinite(s.start) && Number.isFinite(s.end));
  }

  return [];
}
