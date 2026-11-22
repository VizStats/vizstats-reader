import { describe, expect, it } from "vitest";

import {
  resolveKokoroTargets,
  splitForFastStart,
} from "@/lib/speech/kokoro-config";

describe("resolveKokoroTargets", () => {
  it("prefers multi-threaded q8 WASM (~92 MB, clean audio, no shader compile) when crossOriginIsolated", () => {
    expect(
      resolveKokoroTargets({
        crossOriginIsolated: true,
        hasWebGPU: true,
      }),
    ).toEqual([
      { device: "wasm", dtype: "q8" },
      { device: "webgpu", dtype: "fp32" },
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
