import { describe, expect, it } from "vitest";

import {
  castDeviceVoices,
  castNaturalVoices,
  getCastableDeviceVoices,
  getCastCharacters,
} from "@/lib/speech/cast";

function voice(name: string, lang = "en-US") {
  return { lang, name, voiceURI: name } as SpeechSynthesisVoice;
}

describe("getCastCharacters", () => {
  it("lists speaking characters, leads first, ties by first line", () => {
    expect(
      getCastCharacters([null, "STEEL", "BRICK", null, "BRICK", "DAN"]),
    ).toEqual([
      { lines: 2, name: "BRICK" },
      { lines: 1, name: "STEEL" },
      { lines: 1, name: "DAN" },
    ]);
  });

  it("is empty without dialogue", () => {
    expect(getCastCharacters([null, null])).toEqual([]);
  });
});

describe("castNaturalVoices", () => {
  const characters = getCastCharacters(["BRICK", "BRICK", "STEEL", "DAN"]);

  it("gives leads distinct voices and never the narrator's", () => {
    const cast = castNaturalVoices(characters, "am_michael");

    expect(cast).toEqual({
      BRICK: "af_heart",
      DAN: "af_bella",
      STEEL: "bm_george",
    });
    expect(Object.values(cast)).not.toContain("am_michael");
  });

  it("keeps the reader's choices and ignores unknown voices", () => {
    expect(
      castNaturalVoices(characters, "af_heart", {
        BRICK: "bf_lily",
        STEEL: "not-a-voice",
      }),
    ).toMatchObject({ BRICK: "bf_lily", STEEL: "bm_george" });
  });

  it("reuses voices once every one is cast", () => {
    const crowd = getCastCharacters(
      Array.from({ length: 12 }, (_, index) => `EXTRA ${index + 1}`),
    );
    const cast = castNaturalVoices(crowd, "af_heart");

    expect(new Set(Object.values(cast)).size).toBe(9);
    expect(cast["EXTRA 10"]).toBe(cast["EXTRA 1"]);
  });
});

describe("device voices", () => {
  const voices = [
    voice("Samantha"),
    voice("Daniel", "en-GB"),
    voice("Zarvox"),
    voice("Eddy (English (US))"),
    voice("Amélie", "fr-CA"),
    voice("Karen", "en-AU"),
  ];

  it("casts from the narrator's language, without novelty voices", () => {
    expect(
      getCastableDeviceVoices(voices, voices[0]!).map((v) => v.name),
    ).toEqual(["Samantha", "Daniel", "Karen"]);
  });

  it("casts around the narrator and cycles when voices run out", () => {
    const characters = getCastCharacters(["BRICK", "STEEL", "DAN"]);

    expect(castDeviceVoices(characters, voices, voices[0]!)).toEqual({
      BRICK: "Daniel",
      DAN: "Daniel",
      STEEL: "Karen",
    });
  });

  it("keeps a chosen voice only while the device still has it", () => {
    const characters = getCastCharacters(["BRICK", "STEEL"]);

    expect(
      castDeviceVoices(characters, voices, voices[0]!, {
        BRICK: "Karen",
        STEEL: "Gone",
      }),
    ).toEqual({ BRICK: "Karen", STEEL: "Karen" });
  });

  it("falls back to the narrator when no other voice is castable", () => {
    const characters = getCastCharacters(["BRICK"]);

    expect(castDeviceVoices(characters, [voices[0]!], voices[0]!)).toEqual({
      BRICK: "Samantha",
    });
  });
});
