import type { KokoroTarget } from "@/lib/speech/kokoro-messages";

export type KokoroCapabilities = {
  crossOriginIsolated: boolean;
  hasShaderF16: boolean;
  hasWebGPU: boolean;
};

// Minimum passage length before splitting off the leading sentence for fast
// first-audio startup. Short passages already synthesize quickly in one call.
const FAST_START_MIN_LENGTH = 90;
const FAST_START_MAX_LEAD = 140;

/**
 * Returns an ordered fallback chain of Kokoro (device, dtype) targets.
 *
 * - On WebGPU with `shader-f16` (Apple Silicon, modern GPUs), prefer `fp16`
 *   (~163 MB — half the 326 MB `fp32` download and shader memory) and fall
 *   back to `q8` WASM or `fp32` WebGPU if initialization fails.
 * - Without `shader-f16`, prefer multi-threaded `q8` WASM (~92 MB) when
 *   cross-origin isolated so the browser avoids a 326 MB `fp32` download.
 * - Otherwise try WebGPU `fp32` (if available) and always end with `q8` WASM.
 */
export function resolveKokoroTargets({
  crossOriginIsolated,
  hasShaderF16,
  hasWebGPU,
}: KokoroCapabilities): KokoroTarget[] {
  if (hasWebGPU && hasShaderF16) {
    return [
      { device: "webgpu", dtype: "fp16" },
      { device: "wasm", dtype: "q8" },
      { device: "webgpu", dtype: "fp32" },
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
