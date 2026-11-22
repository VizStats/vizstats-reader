import { describe, expect, it } from "vitest";

import {
  resolveKokoroTargets,
  splitForFastStart,
  trimSilence,
} from "@/lib/speech/kokoro-config";

describe("resolveKokoroTargets", () => {
  it("prefers multi-threaded q8 WASM (~92 MB, clean audio, no shader compile) in fast-load mode", () => {
    expect(
      resolveKokoroTargets({
        crossOriginIsolated: true,
        hasWebGPU: true,
        mode: "fast-load",
      }),
    ).toEqual([
      { device: "wasm", dtype: "q8" },
      { device: "webgpu", dtype: "fp32" },
    ]);
  });

  it("prefers WebGPU fp32 when webgpu mode is explicitly chosen", () => {
    expect(
      resolveKokoroTargets({
        crossOriginIsolated: true,
        hasWebGPU: true,
        mode: "webgpu",
      }),
    ).toEqual([
      { device: "webgpu", dtype: "fp32" },
      { device: "wasm", dtype: "q8" },
    ]);
  });

  it("uses only q8 WASM when WebGPU is absent", () => {
    expect(
      resolveKokoroTargets({
        crossOriginIsolated: true,
        hasWebGPU: false,
      }),
    ).toEqual([{ device: "wasm", dtype: "q8" }]);
  });

  it("uses WebGPU fp32 then q8 WASM when crossOriginIsolated is unavailable", () => {
    expect(
      resolveKokoroTargets({
        crossOriginIsolated: false,
        hasWebGPU: true,
      }),
    ).toEqual([
      { device: "webgpu", dtype: "fp32" },
      { device: "wasm", dtype: "q8" },
    ]);
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

describe("splitForFastStart", () => {
  it("keeps short passages intact", () => {
    expect(splitForFastStart("Short intro. Second line.")).toEqual([
      "Short intro. Second line.",
    ]);
  });

  it("keeps single long sentences intact", () => {
    const single = "word ".repeat(30).trim() + ".";

    expect(splitForFastStart(single)).toEqual([single]);
  });

  it("splits off a short leading sentence from a multi-sentence passage", () => {
    const passage =
      "This opens fast. The second sentence adds plenty of detail so the full chunk exceeds the fast-start threshold easily. And a third sentence closes it.";

    expect(splitForFastStart(passage)).toEqual([
      "This opens fast.",
      "The second sentence adds plenty of detail so the full chunk exceeds the fast-start threshold easily. And a third sentence closes it.",
    ]);
  });

  it("does not split when the leading sentence is already long", () => {
    const longLead = `${"word ".repeat(32).trim()}. Short tail.`;

    expect(splitForFastStart(longLead)).toEqual([longLead]);
  });
});
