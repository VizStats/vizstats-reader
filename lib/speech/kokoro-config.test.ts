import { describe, expect, it } from "vitest";

import { resolveKokoroPlan, trimSilence } from "@/lib/speech/kokoro-config";

describe("resolveKokoroPlan", () => {
  const FULL_ON_GPU = { device: "webgpu", dtype: "fp32" };
  const SMALL_ON_CPU = { device: "wasm", dtype: "q8" };

  it("uses WebGPU straight away once the full model is cached", () => {
    expect(
      resolveKokoroPlan({
        crossOriginIsolated: true,
        fullModelCached: true,
        hasWebGPU: true,
      }),
    ).toEqual({ targets: [FULL_ON_GPU, SMALL_ON_CPU], upgrade: null });
  });

  it("speaks on the small CPU model on a first visit, then upgrades to WebGPU", () => {
    expect(
      resolveKokoroPlan({
        crossOriginIsolated: true,
        fullModelCached: false,
        hasWebGPU: true,
      }),
    ).toEqual({ targets: [SMALL_ON_CPU, FULL_ON_GPU], upgrade: FULL_ON_GPU });
  });

  it("loads WebGPU first when the CPU would run single-threaded", () => {
    expect(
      resolveKokoroPlan({
        crossOriginIsolated: false,
        fullModelCached: false,
        hasWebGPU: true,
      }),
    ).toEqual({ targets: [FULL_ON_GPU, SMALL_ON_CPU], upgrade: null });
  });

  it("uses only the small CPU model without WebGPU", () => {
    expect(
      resolveKokoroPlan({
        crossOriginIsolated: true,
        fullModelCached: false,
        hasWebGPU: false,
      }),
    ).toEqual({ targets: [SMALL_ON_CPU], upgrade: null });
  });

  it("keeps to the small CPU model in Data saver, even with WebGPU cached", () => {
    expect(
      resolveKokoroPlan({
        crossOriginIsolated: true,
        fullModelCached: true,
        hasWebGPU: true,
        mode: "data-saver",
      }),
    ).toEqual({ targets: [SMALL_ON_CPU], upgrade: null });
  });
});

describe("trimSilence", () => {
  it("removes long leading and trailing silence while preserving a short breath margin", () => {
    const sampleRate = 1000;
    const samples = new Float32Array(1000);

    // Put audible signal between 400ms and 600ms.
    for (let i = 400; i < 600; i++) {
      samples[i] = 0.5;
    }

    const trimmed = trimSilence(samples, sampleRate);

    // 200ms signal + 20ms lead pad + 40ms trail pad = 260 samples.
    expect(trimmed.length).toBe(260);
    // Signal interior stays intact.
    expect(trimmed[100]).toBeCloseTo(0.5, 4);
  });

  it("returns all-silent clips unchanged", () => {
    const silent = new Float32Array(200);

    expect(trimSilence(silent, 1000)).toBe(silent);
  });
});
