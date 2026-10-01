import { describe, expect, it } from "vitest";

import { getScreenplayBlocks, getScreenplayStats } from "@/lib/fountain/model";
import { parseFountain } from "@/lib/fountain/parse";
import { getReadableSpeech } from "@/lib/markdown/speech";

const script = [
  "Title: Brick & Steel",
  "Credit: Written by",
  "Author: Stu Maschwitz",
  "",
  "# Act One",
  "",
  "= Brick meets Steel.",
  "",
  "EXT. BRICK'S PATIO - DAY",
  "",
  "A gorgeous day. [[sunnier?]]",
  "",
  "STEEL (V.O.)",
  "(quietly)",
  "Beer's ready!",
  "",
  "BRICK",
  "Hold on.",
  "",
  "STEEL ^",
  "No.",
  "",
  "CUT TO:",
  "",
  "INT. HOUSE - DAY",
  "",
  "INT. HOUSE - DAY",
  "",
  "===",
].join("\n");

describe("getScreenplayBlocks", () => {
  const screenplay = parseFountain(script);
  const { headings, spoken } = getScreenplayBlocks(screenplay);

  it("builds the outline from sections and scene headings", () => {
    expect(headings).toEqual([
      {
        id: "screenplay-act-one",
        level: 1,
        sourceLine: 5,
        text: "Act One",
        type: "heading",
      },
      {
        id: "screenplay-ext-bricks-patio---day",
        level: 2,
        sourceLine: 9,
        text: "EXT. BRICK'S PATIO - DAY",
        type: "heading",
      },
      {
        id: "screenplay-int-house---day",
        level: 2,
        sourceLine: 25,
        text: "INT. HOUSE - DAY",
        type: "heading",
      },
      {
        id: "screenplay-int-house---day-2",
        level: 2,
        sourceLine: 27,
        text: "INT. HOUSE - DAY",
        type: "heading",
      },
    ]);
  });

  it("phrases the script for a voice", () => {
    const { chunkLines, chunks, sections } = getReadableSpeech(spoken);

    expect(chunks).toEqual([
      "Brick & Steel. Written by Stu Maschwitz.",
      "Act One.",
      "Exterior. Brick's patio, day.",
      "A gorgeous day.",
      "Steel. Beer's ready!",
      "Brick. Hold on.",
      "Steel. No.",
      "Cut to.",
      "Interior. House, day.",
      "Interior. House, day.",
    ]);
    expect(chunkLines).toEqual([1, 5, 9, 11, 15, 18, 21, 23, 25, 27]);
    expect(sections.map((section) => section.chunkIndex)).toEqual([1, 2, 8, 9]);
  });

  it("starts scene levels at one when there are no sections", () => {
    expect(
      getScreenplayBlocks(parseFountain("INT. HOUSE - DAY\n\nHe waits."))
        .headings[0],
    ).toMatchObject({ level: 1 });
  });

  it("reads a title-only title page", () => {
    expect(
      getReadableSpeech(
        getScreenplayBlocks(parseFountain("Title: Heat\n\nHe waits.")).spoken,
      ).chunks,
    ).toEqual(["Heat.", "He waits."]);
  });
});

describe("getScreenplayStats", () => {
  it("counts printed words and scenes", () => {
    const content =
      "INT. HOUSE - DAY\n\nHe waits. [[note words]]\n\nBOB\nHi there.";

    expect(getScreenplayStats(parseFountain(content), content)).toEqual({
      lines: 6,
      readingMinutes: 1,
      scenes: 1,
      words: 8,
    });
  });
});
