import type { PassageBreak } from "@/lib/markdown/speech";
import { TRIMMED_EDGE_SECONDS } from "@/lib/speech/kokoro-config";

// The silence between one passage's last word and the next passage's first.
// Kokoro pauses about half a second at a full stop inside a passage (measured
// 0.45–0.58 s), so a passage boundary within a paragraph matches it; a new
// paragraph and a heading get progressively more.
export const PASSAGE_PAUSE_SECONDS: Record<PassageBreak, number> = {
  block: 0.75,
  section: 1,
  sentence: 0.5,
};

// Kokoro's own pause at a full stop inside a passage, used to place sentence
// starts within a clip.
const SENTENCE_PAUSE_SECONDS = 0.5;

// Finding those pauses in the audio itself: 10 ms windows whose peak stays
// under trimSilence's threshold count as silent; a run of at least 0.2 s is a
// pause (full stops measure 0.45–0.58 s, most commas less). An estimated
// boundary moves to the strongest pause within 1.5 s of it.
const SILENT_PEAK = 0.004;
const WINDOW_SECONDS = 0.01;
const MIN_PAUSE_SECONDS = 0.2;
const SNAP_RANGE_SECONDS = 1.5;

export type AudioPause = { end: number; start: number };

/**
 * The pauses inside a clip, in seconds from its start. Silence at the very
 * start and end of the clip is not a pause between sentences.
 */
export function findPauses(pcm: Float32Array, sampleRate: number) {
  const pauses: AudioPause[] = [];
  const window = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS));
  const windows = Math.ceil(pcm.length / window);
  let runStart = -1;

  for (let w = 0; w <= windows; w++) {
    let silent = false;

    if (w < windows) {
      let peak = 0;
      const end = Math.min(pcm.length, (w + 1) * window);

      for (let i = w * window; i < end; i++) {
        peak = Math.max(peak, Math.abs(pcm[i]!));
      }

      silent = peak < SILENT_PEAK;
    }

    if (silent && runStart === -1) {
      runStart = w;
    } else if (!silent && runStart !== -1) {
      const touchesEdge = runStart === 0 || w === windows;

      if (!touchesEdge && (w - runStart) * WINDOW_SECONDS >= MIN_PAUSE_SECONDS) {
        pauses.push({
          end: (w * window) / sampleRate,
          start: (runStart * window) / sampleRate,
        });
      }

      runStart = -1;
    }
  }

  return pauses;
}

// Moves each estimated boundary into the strongest real pause near it, in
// order, using each pause once.
function snapToPauses(estimates: number[], pauses: AudioPause[]) {
  const snapped = [...estimates];
  let after = 0;

  for (let index = 1; index < estimates.length; index++) {
    const estimate = estimates[index]!;
    let best: AudioPause | null = null;
    let bestScore = -Infinity;

    for (const pause of pauses) {
      const middle = (pause.start + pause.end) / 2;
      const distance = Math.abs(middle - estimate);

      if (middle <= after || distance > SNAP_RANGE_SECONDS) {
        continue;
      }

      const score = pause.end - pause.start - distance / 4;

      if (score > bestScore) {
        best = pause;
        bestScore = score;
      }
    }

    if (best) {
      snapped[index] = (best.start + best.end) / 2;
    }

    snapped[index] = Math.max(snapped[index]!, after);
    after = snapped[index]!;
  }

  return snapped;
}

/**
 * Seconds of silence to play after a natural-voice clip, on top of the edge
 * silence the clip already keeps. Nothing follows the last passage.
 */
export function getTrailingPause(
  breakType: PassageBreak | undefined,
  isLast: boolean,
) {
  if (isLast) {
    return 0;
  }

  return Math.max(
    0,
    PASSAGE_PAUSE_SECONDS[breakType ?? "block"] - TRIMMED_EDGE_SECONDS,
  );
}

/**
 * When the highlight should move to each sentence of a clip that speaks them
 * all. Speech time is first shared out by character count, setting aside
 * Kokoro's pause at each full stop; given the clip's real pauses, each
 * estimate then moves to the middle of the pause nearest it, so the highlight
 * changes in the silence between sentences. The first boundary is 0.
 */
export function getSentenceBoundaries(
  sentences: string[],
  duration: number,
  pauses: AudioPause[] = [],
) {
  if (sentences.length <= 1 || duration <= 0) {
    return sentences.map(() => 0);
  }

  const lengths = sentences.map((sentence) => Math.max(1, sentence.length));
  const totalChars = lengths.reduce((sum, length) => sum + length, 0);
  const fullStops = sentences.length - 1;
  // Short clips leave no room for full pauses; fall back to plain shares.
  const pause =
    duration - fullStops * SENTENCE_PAUSE_SECONDS > duration / 2
      ? SENTENCE_PAUSE_SECONDS
      : 0;
  const speechTime = duration - fullStops * pause;
  const boundaries = [0];
  let charsBefore = 0;

  for (let index = 1; index < sentences.length; index++) {
    charsBefore += lengths[index - 1]!;

    const start = (charsBefore / totalChars) * speechTime + index * pause;

    boundaries.push(Math.max(0, start - pause / 2));
  }

  return pauses.length > 0 ? snapToPauses(boundaries, pauses) : boundaries;
}

// The sentence playing at `time`, given boundaries from getSentenceBoundaries.
export function getSentenceIndexAt(boundaries: number[], time: number) {
  let index = 0;

  for (let i = 1; i < boundaries.length; i++) {
    if (time >= boundaries[i]!) {
      index = i;
    }
  }

  return index;
}

/**
 * Character offset of each sentence within the passage it came from, for
 * matching a device voice's word boundaries to sentences. A sentence that
 * cannot be found continues from the previous one's end.
 */
export function getSentenceOffsets(text: string, sentences: string[]) {
  const offsets: number[] = [];
  let cursor = 0;

  for (const sentence of sentences) {
    const found = text.indexOf(sentence, cursor);
    const start = found === -1 ? cursor : found;

    offsets.push(start);
    cursor = start + sentence.length;
  }

  return offsets;
}

// The sentence containing a character offset, given getSentenceOffsets.
export function getSentenceIndexAtChar(offsets: number[], charIndex: number) {
  let index = 0;

  for (let i = 1; i < offsets.length; i++) {
    if (charIndex >= offsets[i]!) {
      index = i;
    }
  }

  return index;
}
