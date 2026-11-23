import { describe, expect, it } from "vitest";

import { TRIMMED_EDGE_SECONDS } from "@/lib/speech/kokoro-config";
import {
  PASSAGE_PAUSE_SECONDS,
  findPauses,
  getSentenceBoundaries,
  getSentenceIndexAt,
  getSentenceIndexAtChar,
  getSentenceOffsets,
  getTrailingPause,
} from "@/lib/speech/passage-timing";

describe("getTrailingPause", () => {
  it("lengthens the pause from within a paragraph, to a new block, to a heading", () => {
    const sentence = getTrailingPause("sentence", false);
    const block = getTrailingPause("block", false);
    const section = getTrailingPause("section", false);

    expect(sentence).toBeLessThan(block);
    expect(block).toBeLessThan(section);
  });

  it("counts the clip's own edge silence toward the pause", () => {
    expect(getTrailingPause("block", false) + TRIMMED_EDGE_SECONDS).toBeCloseTo(
      PASSAGE_PAUSE_SECONDS.block,
      6,
    );
  });

  it("adds nothing after the last passage", () => {
    expect(getTrailingPause("section", true)).toBe(0);
  });
});

describe("getSentenceBoundaries", () => {
  it("starts a single sentence at zero", () => {
    expect(getSentenceBoundaries(["Only one."], 3)).toEqual([0]);
  });

  it("places each boundary inside the full-stop pause before its sentence", () => {
    // Two equal sentences in 4.5 s of audio: 4 s of speech plus a 0.5 s
    // pause after the first, so the second starts at 2.5 s.
    const boundaries = getSentenceBoundaries(
      ["Ten chars.", "Ten chars."],
      4.5,
    );

    expect(boundaries[0]).toBe(0);
    // Mid-pause: the first sentence ends at 2.0 s, the second starts at 2.5 s.
    expect(boundaries[1]).toBeCloseTo(2.25, 6);
  });

  it("shares time by length, so a long first sentence holds the highlight longer", () => {
    const [, second] = getSentenceBoundaries(
      ["A much longer opening sentence here.", "Short."],
      6,
    );

    expect(second).toBeGreaterThan(3);
  });

  it("falls back to plain shares when the clip is too short for full pauses", () => {
    const boundaries = getSentenceBoundaries(["One.", "Two.", "Three."], 1);

    expect(boundaries).toHaveLength(3);
    expect(boundaries[1]!).toBeGreaterThan(0);
    expect(boundaries[2]!).toBeLessThan(1);
  });
});

describe("getSentenceIndexAt", () => {
  it("returns the last boundary passed", () => {
    const boundaries = [0, 2, 5];

    expect(getSentenceIndexAt(boundaries, 0)).toBe(0);
    expect(getSentenceIndexAt(boundaries, 1.99)).toBe(0);
    expect(getSentenceIndexAt(boundaries, 2)).toBe(1);
    expect(getSentenceIndexAt(boundaries, 9)).toBe(2);
  });
});

describe("sentence offsets", () => {
  it("finds each sentence in its passage and maps character offsets back", () => {
    const text = "First one. Second one here. Third.";
    const sentences = ["First one.", "Second one here.", "Third."];
    const offsets = getSentenceOffsets(text, sentences);

    expect(offsets).toEqual([0, 11, 28]);
    expect(getSentenceIndexAtChar(offsets, 0)).toBe(0);
    expect(getSentenceIndexAtChar(offsets, 12)).toBe(1);
    expect(getSentenceIndexAtChar(offsets, 30)).toBe(2);
  });

  it("continues from the previous sentence when one cannot be found", () => {
    expect(getSentenceOffsets("Alpha. Beta.", ["Alpha.", "Gamma."])).toEqual([
      0, 6,
    ]);
  });
});

describe("pauses in the audio", () => {
  const SAMPLE_RATE = 1000;

  // Speech is a steady tone; silence is zeros. Segments in seconds.
  function clip(segments: Array<[number, "speech" | "silence"]>) {
    const total = segments.reduce((sum, [seconds]) => sum + seconds, 0);
    const pcm = new Float32Array(Math.round(total * SAMPLE_RATE));
    let at = 0;

    for (const [seconds, kind] of segments) {
      const length = Math.round(seconds * SAMPLE_RATE);

      if (kind === "speech") {
        pcm.fill(0.3, at, at + length);
      }

      at += length;
    }

    return pcm;
  }

  it("finds pauses of 0.2 s or more inside the clip, ignoring its edges", () => {
    const pcm = clip([
      [0.05, "silence"],
      [1, "speech"],
      [0.1, "silence"], // too short: a comma at most
      [1, "speech"],
      [0.5, "silence"], // a full stop
      [1, "speech"],
      [0.04, "silence"],
    ]);

    expect(findPauses(pcm, SAMPLE_RATE)).toEqual([{ end: 2.65, start: 2.15 }]);
  });

  it("moves an estimated boundary into the real pause near it", () => {
    // The second sentence is short on the page but long when spoken (its
    // numbers are read out in words), so a length-based estimate gives the
    // first sentence too much time and lands about a second late.
    const pcm = clip([
      [2, "speech"],
      [0.5, "silence"],
      [3, "speech"],
    ]);
    const pauses = findPauses(pcm, SAMPLE_RATE);
    const [, estimated] = getSentenceBoundaries(
      ["A first sentence of some length.", "Then $3.5bn in 2025."],
      5.5,
    );
    const [, snapped] = getSentenceBoundaries(
      ["A first sentence of some length.", "Then $3.5bn in 2025."],
      5.5,
      pauses,
    );

    expect(Math.abs(estimated! - 2.25)).toBeGreaterThan(0.5);
    expect(snapped).toBeCloseTo(2.25, 2);
  });

  it("prefers a full-stop pause over a nearer comma pause", () => {
    const pauses = [
      { end: 2.3, start: 2.1 }, // comma, right at the estimate
      { end: 3.5, start: 3.0 }, // full stop, a little later
    ];
    const [, snapped] = getSentenceBoundaries(["One two three.", "Four."], 5, pauses);

    expect(snapped).toBeCloseTo(3.25, 2);
  });
});
