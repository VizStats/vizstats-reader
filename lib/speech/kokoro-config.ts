import type {
  KokoroPerformanceMode,
  KokoroTarget,
} from "@/lib/speech/kokoro-messages";

export type KokoroCapabilities = {
  crossOriginIsolated: boolean;
  hasWebGPU: boolean;
  mode?: KokoroPerformanceMode;
};

// Minimum passage length before splitting off the leading sentence for fast
// first-audio startup. Short passages already synthesize quickly in one call.
const FAST_START_MIN_LENGTH = 90;
const FAST_START_MAX_LEAD = 140;

const SILENCE_THRESHOLD = 0.004;
const LEAD_PAD_SECONDS = 0.02;
const TRAIL_PAD_SECONDS = 0.04;
const EDGE_FADE_SECONDS = 0.005;

/**
 * Returns an ordered fallback chain of Kokoro (device, dtype) targets.
 *
 * Kokoro-82M's ISTFTNet vocoder produces cracked audio in `fp16` on WebGPU, so
 * only the two clean configurations are used:
 * - Multi-threaded `q8` on WASM (~92 MB): fast initial load, clean voice
 *   fidelity, and no multi-second WebGPU shader compilation delay.
 * - `fp32` on WebGPU (~326 MB): slower first load, fastest per-paragraph
 *   synthesis for long documents when `mode === "webgpu"`.
 */
export function resolveKokoroTargets({
  crossOriginIsolated,
  hasWebGPU,
  mode = "fast-load",
}: KokoroCapabilities): KokoroTarget[] {
  if (mode === "webgpu" && hasWebGPU) {
    return [
      { device: "webgpu", dtype: "fp32" },
      { device: "wasm", dtype: "q8" },
    ];
  }

  if (crossOriginIsolated) {
    return hasWebGPU
      ? [
          { device: "wasm", dtype: "q8" },
          { device: "webgpu", dtype: "fp32" },
        ]
      : [{ device: "wasm", dtype: "q8" }];
  }

  if (hasWebGPU) {
    return [
      { device: "webgpu", dtype: "fp32" },
      { device: "wasm", dtype: "q8" },
    ];
  }

  return [{ device: "wasm", dtype: "q8" }];
}

/**
 * Trims Kokoro's baked-in leading and trailing silence from a synthesized
 * waveform, keeping a short natural breath margin and micro-fade so adjacent
 * passages flow without half-second dead gaps or edge clicks.
 */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
): Float32Array {
  if (samples.length === 0 || sampleRate <= 0) {
    return samples;
  }

  let first = -1;
  let last = -1;

  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) >= SILENCE_THRESHOLD) {
      first = i;
      break;
    }
  }

  if (first === -1) {
    return samples;
  }

  for (let i = samples.length - 1; i >= first; i--) {
    if (Math.abs(samples[i]!) >= SILENCE_THRESHOLD) {
      last = i;
      break;
    }
  }

  const leadPad = Math.round(sampleRate * LEAD_PAD_SECONDS);
  const trailPad = Math.round(sampleRate * TRAIL_PAD_SECONDS);
  const start = Math.max(0, first - leadPad);
  const end = Math.min(samples.length, last + 1 + trailPad);

  if (start === 0 && end === samples.length) {
    return samples;
  }

  const trimmed = samples.slice(start, end);
  const fadeSamples = Math.min(
    Math.round(sampleRate * EDGE_FADE_SECONDS),
    Math.floor(trimmed.length / 4),
  );

  for (let i = 0; i < fadeSamples; i++) {
    const gain = i / fadeSamples;

    trimmed[i] = trimmed[i]! * gain;
    trimmed[trimmed.length - 1 - i] = trimmed[trimmed.length - 1 - i]! * gain;
  }

  return trimmed;
}

/**
 * Splits a multi-sentence passage into a short leading sentence and its
 * remainder so the play head starts speaking faster while the tail synthesizes.
 *
 * Returns a single-element array when the passage is already short or has no
 * clean early sentence break. Does not alter passage indexing or highlights.
 */
export function splitForFastStart(text: string): string[] {
  const trimmed = text.trim();

  if (trimmed.length < FAST_START_MIN_LENGTH) {
    return trimmed ? [trimmed] : [];
  }

  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);

  if (!sentences || sentences.length < 2) {
    return [trimmed];
  }

  const first = sentences[0]?.trim() ?? "";
  const rest = sentences.slice(1).join(" ").replace(/\s+/g, " ").trim();

  if (!first || !rest || first.length > FAST_START_MAX_LEAD) {
    return [trimmed];
  }

  return [first, rest];
}
