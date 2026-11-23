import type {
  KokoroPerformanceMode,
  KokoroTarget,
} from "@/lib/speech/kokoro-messages";

export type KokoroCapabilities = {
  crossOriginIsolated: boolean;
  // Whether the full fp32 model is already in the browser's model cache.
  fullModelCached: boolean;
  hasWebGPU: boolean;
  mode?: KokoroPerformanceMode;
};

export type KokoroLoadPlan = {
  // Tried in order; the first that loads is the one that speaks.
  targets: KokoroTarget[];
  // Loaded in the background once the first target is speaking, then swapped
  // in for the passages that follow.
  upgrade: KokoroTarget | null;
};

const FULL_ON_GPU: KokoroTarget = { device: "webgpu", dtype: "fp32" };
const SMALL_ON_CPU: KokoroTarget = { device: "wasm", dtype: "q8" };

const SILENCE_THRESHOLD = 0.004;
const LEAD_PAD_SECONDS = 0.02;
const TRAIL_PAD_SECONDS = 0.04;
const EDGE_FADE_SECONDS = 0.005;

// The silence trimSilence leaves at a clip's edges, which counts toward the
// pause between passages.
export const TRIMMED_EDGE_SECONDS = LEAD_PAD_SECONDS + TRAIL_PAD_SECONDS;

/**
 * Chooses how the natural voice loads.
 *
 * The full fp32 model on WebGPU (~326 MB) generates speech several times
 * faster than it plays; the 92 MB q8 model on the CPU barely keeps up even
 * multi-threaded, and falls behind single-threaded, so long reads pause.
 * Kokoro's vocoder cracks in fp16, so fp16 is never used.
 *
 * - WebGPU with the full model cached: WebGPU straight away.
 * - WebGPU on a first visit with cross-origin isolation (multi-threaded CPU):
 *   speak on the small model while the full one downloads, then switch.
 * - WebGPU on a first visit without isolation: the single-threaded CPU is too
 *   slow to listen to, so load the full model first.
 * - No WebGPU, or Data saver: the small CPU model only.
 */
export function resolveKokoroPlan({
  crossOriginIsolated,
  fullModelCached,
  hasWebGPU,
  mode = "auto",
}: KokoroCapabilities): KokoroLoadPlan {
  if (mode === "data-saver" || !hasWebGPU) {
    return { targets: [SMALL_ON_CPU], upgrade: null };
  }

  if (fullModelCached || !crossOriginIsolated) {
    return { targets: [FULL_ON_GPU, SMALL_ON_CPU], upgrade: null };
  }

  return { targets: [SMALL_ON_CPU, FULL_ON_GPU], upgrade: FULL_ON_GPU };
}

/**
 * Trims Kokoro's baked-in leading and trailing silence (about 0.3 s and 0.5 s)
 * so the reader sets the pause between passages itself, keeping a short margin
 * and a micro-fade against edge clicks. Pauses inside a passage are Kokoro's
 * own and are left alone.
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
