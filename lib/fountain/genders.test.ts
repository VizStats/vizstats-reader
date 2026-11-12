import { describe, expect, it } from "vitest";

import { getCharacterGenders } from "@/lib/fountain/genders";
import { parseFountain } from "@/lib/fountain/parse";

function genders(source: string) {
  return getCharacterGenders(parseFountain(source));
}

describe("getCharacterGenders", () => {
  it("reads pronouns that follow a character's name in action", () => {
    expect(
      genders(`INT. HANGAR - NIGHT

JUNE (40s), a retired pilot, checks her watch. She is late.

OTTO wipes his hands on a rag.

JUNE
You kept her flying.

OTTO
Somebody had to.
`),
    ).toEqual({ JUNE: "female", OTTO: "male" });
  });

  it("gives a pronoun to the nearest name, not the first one", () => {
    expect(
      genders(`INT. CAR - DAY

BRICK and STEEL get in. Steel adjusts her mirror. Brick starts the engine; he waits.

BRICK
Ready?

STEEL
Drive.
`),
    ).toEqual({ BRICK: "male", STEEL: "female" });
  });

  it("reads gendered words in the cue and the introduction", () => {
    expect(
      genders(`EXT. MARKET - DAY

A FISHERMAN shouts prices. RAY, an old man in a cap, haggles.

OLD WOMAN
Too much.

MRS. HALE
Far too much.

FISHERMAN
Then go elsewhere.

RAY
We will.
`),
    ).toEqual({
      FISHERMAN: "male",
      "MRS. HALE": "female",
      "OLD WOMAN": "female",
      RAY: "male",
    });
  });

  it("leaves a character out when the script does not say", () => {
    expect(
      genders(`INT. OFFICE - DAY

SAM enters. KIT looks up.

SAM
Morning.

KIT
Is it?
`),
    ).toEqual({});
  });

  it("does not read a name inside ordinary words", () => {
    expect(
      genders(`EXT. DOCK - DAWN

The ship will sail at first light. She is ready.

WILL
Good.
`),
    ).toEqual({});
  });
});
