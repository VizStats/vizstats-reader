import { describe, expect, it } from "vitest";

import {
  resolveKokoroTargets,
  splitForFastStart,
} from "@/lib/speech/kokoro-config";

describe("resolveKokoroTargets", () => {
  it("prefers fp16 on WebGPU when shader-f16 is supported, with q8 WASM fallback", () => {
    expect(
      resolveKokoroTargets({
        crossOriginIsolated: true,
        hasShaderF16: true,
        hasWebGPU: true,
      }),
    ).toEqual([
      { device: "webgpu", dtype: "fp16" },
      { device: "wasm", dtype: "q8" },
      { device: "webgpu", dtype: "fp32" },
    ]);
  });

  it("prefers multi-threaded q8 WASM over 326 MB fp32 when WebGPU lacks shader-f16", () => {
    expect(
      resolveKokoroTargets({
        crossOriginIsolated: true,
        hasShaderF16: false,
        hasWebGPU: true,
      }),
    ).toEqual([
      { device: "wasm", dtype: "q8" },
      { device: "webgpu", dtype: "fp32" },
    ]);
  });

  it("uses WebGPU fp32 then q8 WASM when neither shader-f16 nor crossOriginIsolated is available", () => {
    expect(
      resolveKokoroTargets({
        crossOriginIsolated: false,
        hasShaderF16: false,
        hasWebGPU: true,
      }),
    ).toEqual([
      { device: "webgpu", dtype: "fp32" },
      { device: "wasm", dtype: "q8" },
    ]);
  });

  it("falls back to q8 WASM when WebGPU is absent", () => {
    expect(
      resolveKokoroTargets({
        crossOriginIsolated: true,
        hasShaderF16: false,
        hasWebGPU: false,
      }),
    ).toEqual([{ device: "wasm", dtype: "q8" }]);
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
