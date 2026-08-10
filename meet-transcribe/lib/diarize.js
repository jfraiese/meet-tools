// Speaker turns, and how transcript segments are matched to them.
//
// The clustering threshold is only used when the speaker count is unknown, and
// it is not to be trusted: measured against a 3-speaker recording it found 21
// speakers at 0.80, 18 at 0.90, 13 at 0.95 and still 12 at 0.99. Given the
// count it is exact. That is why the caller asks.

const FALLBACK_THRESHOLD = 0.95;

const TURN = /^\s*([\d.]+)\s+--\s+([\d.]+)\s+speaker_(\d+)\s*$/;

export function diarizeArgs({ wav, segmentationModel, embeddingModel, speakers }) {
  return [
    // Without this the configuration dump is printed alongside the turns.
    '--print-args=false',
    speakers > 0
      ? `--clustering.num-clusters=${speakers}`
      : `--clustering.cluster-threshold=${FALLBACK_THRESHOLD}`,
    '--segmentation.provider=coreml',
    '--embedding.provider=coreml',
    `--segmentation.pyannote-model=${segmentationModel}`,
    `--embedding.model=${embeddingModel}`,
    wav,
  ];
}

export function parseTurns(stdout) {
  return String(stdout ?? '')
    .split('\n')
    .map((line) => TURN.exec(line))
    .filter(Boolean)
    .map(([, start, end, index]) => ({
      start: Number(start),
      end: Number(end),
      speaker: `SPEAKER_${index.padStart(2, '0')}`,
    }));
}

const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/**
 * Overlap, weighted by how much of the turn that overlap accounts for:
 * `shared² / turnDuration`.
 *
 * Plain maximum overlap is wrong here, and visibly so. The diarizer emits
 * nested turns — a ten-second run by one speaker containing a half-second
 * interjection by another — and under plain overlap the long turn always wins,
 * because it covers the short segment completely. The result was one speaker
 * swallowing an entire three-way conversation, including a line where someone
 * addresses another participant by name.
 *
 * Weighting by coverage makes a turn that is *entirely* this segment beat a
 * turn that merely contains it, while still letting a genuinely dominant turn
 * win over a brief clip of its neighbour.
 */
const score = (segment, turn) => {
  const shared = overlap(segment, turn);
  if (shared <= 0) return 0;
  const duration = Math.max(turn.end - turn.start, 1e-6);
  return (shared * shared) / duration;
};

export function assignSpeakers(segments, turns) {
  let previous = null;
  return segments.map((segment) => {
    if (turns.length === 0) return { ...segment, speaker: null };

    let best = null;
    let bestScore = 0;
    for (const turn of turns) {
      const value = score(segment, turn);
      // Strictly greater, so an exact tie keeps the earlier turn.
      if (value > bestScore) {
        bestScore = value;
        best = turn;
      }
    }

    // A segment falling in a gap continues the current speaker: a stray
    // UNKNOWN mid-conversation reads as a bug, and continuing is right far
    // more often than not.
    const speaker = best ? best.speaker : (previous ?? 'SPEAKER_00');
    previous = speaker;
    return { ...segment, speaker };
  });
}

export function applyNames(labelled, names) {
  if (!names?.length) return { labelled, mapping: {}, unused: [] };

  // Order of first appearance is the only ordering the tool can know — label
  // numbers come from clustering and mean nothing to a person.
  const order = [];
  for (const { speaker } of labelled) {
    if (speaker && !order.includes(speaker)) order.push(speaker);
  }

  const mapping = {};
  order.forEach((speaker, i) => {
    if (names[i]) mapping[speaker] = names[i];
  });

  return {
    labelled: labelled.map((s) => ({ ...s, speaker: mapping[s.speaker] ?? s.speaker })),
    mapping,
    unused: names.slice(order.length),
  };
}

export const formatText = (labelled) =>
  labelled.map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join('\n') + '\n';

const stamp = (seconds) => {
  const ms = Math.round(seconds * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:` +
    `${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
  );
};

export const formatSrt = (labelled) =>
  labelled
    .map((s, i) => {
      const text = s.speaker ? `${s.speaker}: ${s.text}` : s.text;
      return `${i + 1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${text}\n`;
    })
    .join('\n');
