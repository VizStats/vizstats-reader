import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import {
  decodePcm16,
  encodePcm16,
  loadPersistedAudio,
  savePersistedAudio,
} from "@/lib/speech/kokoro-cache";

describe("kokoro-cache", () => {
  it("round-trips Float32 PCM through compact 16-bit storage", () => {
    const samples = new Float32Array([-1, -0.5, 0, 0.25, 0.75, 1]);
    const restored = decodePcm16(encodePcm16(samples));

    expect(restored.length).toBe(samples.length);

    for (let i = 0; i < samples.length; i++) {
      expect(restored[i]).toBeCloseTo(samples[i]!, 3);
    }
  });

  it("persists generated chunks in IndexedDB and evicts the oldest past the limit", async () => {
    await savePersistedAudio(
      "af_heart|first",
      { pcm: new Float32Array([0.1, 0.2]), sampleRate: 24_000 },
      2,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await savePersistedAudio(
      "af_heart|second",
      { pcm: new Float32Array([0.3, 0.4]), sampleRate: 24_000 },
      2,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await savePersistedAudio(
      "af_heart|third",
      { pcm: new Float32Array([0.5, 0.6]), sampleRate: 24_000 },
      2,
    );

    expect(await loadPersistedAudio("af_heart|first")).toBeNull();

    const second = await loadPersistedAudio("af_heart|second");
    const third = await loadPersistedAudio("af_heart|third");

    expect(second?.sampleRate).toBe(24_000);
    expect(second?.pcm[0]).toBeCloseTo(0.3, 3);
    expect(third?.sampleRate).toBe(24_000);
    expect(third?.pcm[1]).toBeCloseTo(0.6, 3);
  });
});
