import type { KokoroTarget } from "@/lib/speech/kokoro-messages";

export type KokoroCapabilities = {
  crossOriginIsolated: boolean;
  hasWebGPU: boolean;
};

// Minimum passage length before splitting off the leading sentence for fast
// first-audio startup. Short passages already synthesize quickly in one call.
const FAST_START_MIN_LENGTH = 90;
const FAST_START_MAX_LEAD = 140;

/**
 * Returns an ordered fallback chain of Kokoro (device, dtype) targets.
 *
 * Kokoro-82M's ISTFTNet vocoder produces cracked audio in `fp16` on WebGPU, so
 * only the two clean configurations are used:
 * - Multi-threaded `q8` on WASM (~92 MB): 3.5× smaller than WebGPU `fp32`,
 *   clean voice fidelity, and no multi-second WebGPU shader compilation delay
 *   on page load. Preferred whenever cross-origin isolation enables WASM
 *   threads.
 * - `fp32` on WebGPU (~326 MB): clean fallback when WASM threading is
 *   unavailable (e.g. browsers without COEP credentialless) or WASM fails.
 */
export function resolveKokoroTargets({
  crossOriginIsolated,
  hasWebGPU,
}: KokoroCapabilities): KokoroTarget[] {
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
