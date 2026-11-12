import { describe, expect, it } from "vitest";

import {
  FLAG_NOTE,
  getFlagLines,
  isLineFlagged,
  toggleLineFlag,
} from "@/lib/fountain/flags";
import { getScreenplayBlocks } from "@/lib/fountain/model";
import { parseFountain } from "@/lib/fountain/parse";

const SCRIPT = `Title: Low Tide

INT. HANGAR - NIGHT #4#

JUNE checks the gauges.
They hold.

JUNE
You kept her flying.
(beat)
Thank you.

CUT TO:

> THE END <

> SMASH CUT TO BLACK.
`;

describe("getFlagLines", () => {
  it("maps each spoken passage to its last line", () => {
    const lines = getFlagLines(parseFountain(SCRIPT), SCRIPT);

    expect(Object.fromEntries(lines)).toEqual({
      3: 3, // scene heading
      5: 6, // two-line action: the flag follows "They hold."
      9: 9, // dialogue
      11: 11, // dialogue after the parenthetical
      15: 15, // centered
      17: 17, // forced transition
    });
  });

  it("leaves out natural transitions, which a note would break", () => {
    const lines = getFlagLines(parseFountain(SCRIPT), SCRIPT);

    expect(lines.has(13)).toBe(false);
  });
});

describe("toggleLineFlag", () => {
  it("adds a flag at the end of a line and takes it off again", () => {
    const flagged = toggleLineFlag(SCRIPT, 9);

    expect(flagged.split("\n")[8]).toBe(`You kept her flying. ${FLAG_NOTE}`);
    expect(isLineFlagged(flagged, 9)).toBe(true);
    expect(toggleLineFlag(flagged, 9)).toBe(SCRIPT);
  });

  it("keeps scene numbers and centering working", () => {
    const flagged = toggleLineFlag(toggleLineFlag(SCRIPT, 3), 15);
    const [heading, , , , centered] = parseFountain(flagged).elements;

    expect(flagged.split("\n")[2]).toBe(`INT. HANGAR - NIGHT ${FLAG_NOTE} #4#`);
    expect(heading).toMatchObject({
      sceneNumber: "4",
      type: "scene-heading",
    });
    expect(centered).toMatchObject({ type: "centered" });
    expect(toggleLineFlag(toggleLineFlag(flagged, 3), 15)).toBe(SCRIPT);
  });

  it("keeps Windows line endings", () => {
    const windows = SCRIPT.replace(/\n/g, "\r\n");

    expect(toggleLineFlag(windows, 9).split("\r\n")[8]).toBe(
      `You kept her flying. ${FLAG_NOTE}`,
    );
  });

  it("changes no spoken words and no heading ids", () => {
    const before = getScreenplayBlocks(parseFountain(SCRIPT));
    const after = getScreenplayBlocks(
      parseFountain(toggleLineFlag(toggleLineFlag(SCRIPT, 3), 9)),
    );

    expect(after.spoken.map((block) => "text" in block && block.text)).toEqual(
      before.spoken.map((block) => "text" in block && block.text),
    );
    expect(after.headings.map((heading) => heading.id)).toEqual(
      before.headings.map((heading) => heading.id),
    );
  });

  it("counts flags under each heading for the outline", () => {
    const { headings } = getScreenplayBlocks(
      parseFountain(toggleLineFlag(toggleLineFlag(SCRIPT, 3), 9)),
    );

    expect(headings[0]?.flags).toBe(2);
  });
});
