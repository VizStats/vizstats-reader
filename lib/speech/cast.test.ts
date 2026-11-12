import { describe, expect, it } from "vitest";

import {
  castDeviceVoices,
  castNaturalVoices,
  getCastableDeviceVoices,
  getCastCharacters,
  getDeviceVoiceGender,
  getSharedVoicePitches,
} from "@/lib/speech/cast";
import { KOKORO_VOICES } from "@/lib/speech/kokoro-messages";

function voice(name: string, lang = "en-US") {
  return { lang, name, voiceURI: name } as SpeechSynthesisVoice;
}

const genderOf = (id: string) =>
  KOKORO_VOICES.find((candidate) => candidate.id === id)?.gender;

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

  it("carries the gender the script gives", () => {
    expect(
      getCastCharacters(["JUNE", "OTTO"], { JUNE: "female" }),
    ).toEqual([
      { gender: "female", lines: 1, name: "JUNE" },
      { lines: 1, name: "OTTO" },
    ]);
  });

  it("is empty without dialogue", () => {
    expect(getCastCharacters([null, null])).toEqual([]);
  });
});

describe("castNaturalVoices", () => {
  it("casts each character a voice of their gender", () => {
    const characters = getCastCharacters(
      ["JUNE", "JUNE", "OTTO", "MAE", "RAY"],
      { JUNE: "female", MAE: "female", OTTO: "male", RAY: "male" },
    );
    const cast = castNaturalVoices(characters, "af_heart");

    expect(cast).toEqual({
      JUNE: "bf_emma",
      MAE: "af_bella",
      OTTO: "am_michael",
      RAY: "bm_george",
    });
  });

  it("alternates voices for characters the script does not gender", () => {
    const characters = getCastCharacters(["BRICK", "BRICK", "STEEL", "DAN"]);
    const cast = castNaturalVoices(characters, "am_michael");

    expect(cast).toEqual({
      BRICK: "bm_george",
      DAN: "am_fenrir",
      STEEL: "af_heart",
    });
    expect(Object.values(cast)).not.toContain("am_michael");
  });

  it("keeps the reader's choices and casts others around them", () => {
    const characters = getCastCharacters(["JUNE", "MAE"], {
      JUNE: "female",
      MAE: "female",
    });

    expect(
      castNaturalVoices(characters, "af_heart", {
        JUNE: "not-a-voice",
        MAE: "bf_emma",
      }),
    ).toEqual({ JUNE: "af_bella", MAE: "bf_emma" });
  });

  it("gives every character a different voice until a gender runs out", () => {
    const crowd = getCastCharacters(
      Array.from({ length: 14 }, (_, index) => `GUARD ${index + 1}`),
      Object.fromEntries(
        Array.from({ length: 14 }, (_, index) => [
          `GUARD ${index + 1}`,
          "male" as const,
        ]),
      ),
    );
    const cast = castNaturalVoices(crowd, "af_heart");

    expect(new Set(Object.values(cast)).size).toBe(12);
    expect(Object.values(cast).every((id) => genderOf(id) === "male")).toBe(
      true,
    );
    expect(cast["GUARD 13"]).toBe(cast["GUARD 1"]);
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

  it("reads a voice's gender from its name", () => {
    expect(
      [
        "Samantha (Enhanced)",
        "Daniel (English (United Kingdom))",
        "Microsoft David - English (United States)",
        "Microsoft Aria Online (Natural) - English (United States)",
        "Google UK English Female",
        "Google UK English Male",
        "Google US English",
        "Narrator",
      ].map((name) => getDeviceVoiceGender({ name })),
    ).toEqual([
      "female",
      "male",
      "male",
      "female",
      "female",
      "male",
      "female",
      undefined,
    ]);
  });

  it("casts by gender, sharing voices once a gender runs out", () => {
    const characters = getCastCharacters(["BRICK", "STEEL", "DAN", "MAE"], {
      BRICK: "male",
      DAN: "male",
      MAE: "female",
      STEEL: "female",
    });

    expect(castDeviceVoices(characters, voices, voices[0]!)).toEqual({
      BRICK: "Daniel",
      DAN: "Daniel",
      MAE: "Karen",
      STEEL: "Karen",
    });
  });

  it("alternates voices for characters the script does not gender", () => {
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
    ).toEqual({ BRICK: "Karen", STEEL: "Daniel" });
  });

  it("falls back to the narrator when no other voice is castable", () => {
    const characters = getCastCharacters(["BRICK"]);

    expect(castDeviceVoices(characters, [voices[0]!], voices[0]!)).toEqual({
      BRICK: "Samantha",
    });
  });
});

describe("getSharedVoicePitches", () => {
  it("pitches apart characters who share a voice, narrator included", () => {
    const characters = getCastCharacters(["BRICK", "STEEL", "DAN", "MAE"]);

    expect(
      getSharedVoicePitches(
        characters,
        { BRICK: "Daniel", DAN: "Daniel", MAE: "Samantha", STEEL: "Karen" },
        "Samantha",
      ),
    ).toEqual({ BRICK: 1, DAN: 0.82, MAE: 0.82, STEEL: 1 });
  });
});
