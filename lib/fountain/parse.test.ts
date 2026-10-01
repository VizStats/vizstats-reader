import { describe, expect, it } from "vitest";

import { hasFountainExtension, parseFountain } from "@/lib/fountain/parse";

function types(source: string) {
  return parseFountain(source).elements.map((element) => element.type);
}

describe("parseFountain", () => {
  it("reads a title page up to the first blank line", () => {
    const { elements, titlePage } = parseFountain(
      [
        "Title: **BRICK & STEEL**",
        "Credit: Written by",
        "Author: Stu Maschwitz",
        "Contact:",
        "    Next Level Productions",
        "    1588 Mission Dr.",
        "",
        "EXT. BRICK'S PATIO - DAY",
      ].join("\n"),
    );

    expect(titlePage).toEqual([
      { key: "Title", line: 1, values: ["**BRICK & STEEL**"] },
      { key: "Credit", line: 2, values: ["Written by"] },
      { key: "Author", line: 3, values: ["Stu Maschwitz"] },
      {
        key: "Contact",
        line: 4,
        values: ["Next Level Productions", "1588 Mission Dr."],
      },
    ]);
    expect(elements[0]).toMatchObject({ line: 8, type: "scene-heading" });
  });

  it("does not treat a scene heading or plain action as a title page", () => {
    expect(
      parseFountain("INT. HOUSE: KITCHEN - DAY\n\nHe waits.").titlePage,
    ).toEqual([]);
    expect(parseFountain("He waits.").titlePage).toEqual([]);
  });

  it("recognizes natural and forced scene headings with scene numbers", () => {
    const { elements } = parseFountain(
      [
        "INT. HOUSE - DAY #1A#",
        "",
        "int./ext. car - moving",
        "",
        ".SNIPER SCOPE POV",
        "",
        "I/E TRAIN - NIGHT",
        "",
        "...and then he left.",
      ].join("\n"),
    );

    expect(elements).toEqual([
      {
        line: 1,
        sceneNumber: "1A",
        text: "INT. HOUSE - DAY",
        type: "scene-heading",
      },
      {
        line: 3,
        sceneNumber: null,
        text: "int./ext. car - moving",
        type: "scene-heading",
      },
      {
        line: 5,
        sceneNumber: null,
        text: "SNIPER SCOPE POV",
        type: "scene-heading",
      },
      {
        line: 7,
        sceneNumber: null,
        text: "I/E TRAIN - NIGHT",
        type: "scene-heading",
      },
      { line: 9, text: "...and then he left.", type: "action" },
    ]);
  });

  it("does not read words that merely start like a heading as scene headings", () => {
    expect(types("INTERIOR DESIGN is his passion.")).toEqual(["action"]);
  });

  it("parses a character cue with extension, parentheticals, and dialogue", () => {
    const { elements } = parseFountain(
      [
        "STEEL (V.O.)",
        "(quietly)",
        "The man's a myth!",
        "Nobody's seen him.",
        "(beat)",
        "Until now.",
      ].join("\n"),
    );

    expect(elements).toEqual([
      {
        character: "STEEL",
        extension: "(V.O.)",
        line: 1,
        runs: [
          { line: 2, text: "(quietly)", type: "parenthetical" },
          {
            line: 3,
            text: "The man's a myth!\nNobody's seen him.",
            type: "dialogue",
          },
          { line: 5, text: "(beat)", type: "parenthetical" },
          { line: 6, text: "Until now.", type: "dialogue" },
        ],
        type: "dialogue",
      },
    ]);
  });

  it("accepts lowercase extensions, forced cues, and lyric lines in dialogue", () => {
    const { elements } = parseFountain(
      [
        "HANS (on the radio)",
        "Hello.",
        "",
        "@McCLANE",
        "~Ode to joy",
        "Yippee.",
      ].join("\n"),
    );

    expect(elements).toMatchObject([
      { character: "HANS", extension: "(on the radio)", type: "dialogue" },
      {
        character: "McCLANE",
        runs: [
          { text: "Ode to joy", type: "lyric" },
          { text: "Yippee.", type: "dialogue" },
        ],
        type: "dialogue",
      },
    ]);
  });

  it("keeps a two-space line inside dialogue", () => {
    const { elements } = parseFountain("DEALER\nTen.\n  \nFour.");

    expect(elements[0]).toMatchObject({
      runs: [{ text: "Ten.\n\nFour.", type: "dialogue" }],
    });
  });

  it("needs a following line for a character cue", () => {
    expect(types("He shouts:\n\nBOOM!")).toEqual(["action", "action"]);
  });

  it("pairs a caret cue with the previous dialogue as dual dialogue", () => {
    const { elements } = parseFountain(
      ["BRICK", "Screw retirement.", "", "STEEL ^", "Screw retirement."].join(
        "\n",
      ),
    );

    expect(elements).toMatchObject([
      {
        left: { character: "BRICK", line: 1 },
        line: 1,
        right: { character: "STEEL", line: 4 },
        type: "dual-dialogue",
      },
    ]);
  });

  it("keeps a caret cue with nothing to pair as ordinary dialogue", () => {
    expect(parseFountain("STEEL ^\nAlone.").elements[0]).toMatchObject({
      character: "STEEL",
      type: "dialogue",
    });
  });

  it("recognizes transitions, forced transitions, and centered text", () => {
    const { elements } = parseFountain(
      [
        "He leaves.",
        "",
        "CUT TO:",
        "",
        "> Burn to white.",
        "",
        ">THE END<",
      ].join("\n"),
    );

    expect(elements).toEqual([
      { line: 1, text: "He leaves.", type: "action" },
      { line: 3, text: "CUT TO:", type: "transition" },
      { line: 5, text: "Burn to white.", type: "transition" },
      { line: 7, text: "THE END", type: "centered" },
    ]);
  });

  it("parses sections, synopses, lyrics, and page breaks", () => {
    const { elements } = parseFountain(
      [
        "# Act One",
        "",
        "## Sequence",
        "",
        "= Brick meets Steel.",
        "",
        "~Willy Wonka!",
        "~Willy Wonka!",
        "",
        "===",
      ].join("\n"),
    );

    expect(elements).toEqual([
      { level: 1, line: 1, text: "Act One", type: "section" },
      { level: 2, line: 3, text: "Sequence", type: "section" },
      { line: 5, text: "Brick meets Steel.", type: "synopsis" },
      { line: 7, text: "Willy Wonka!\nWilly Wonka!", type: "lyrics" },
      { line: 10, type: "page-break" },
    ]);
  });

  it("keeps action line breaks, forced action, and indentation", () => {
    const { elements } = parseFountain(
      "!SCANNING THE AISLES...\n\tWhere is it?\nGone.",
    );

    expect(elements).toEqual([
      {
        line: 1,
        text: "SCANNING THE AISLES...\n    Where is it?\nGone.",
        type: "action",
      },
    ]);
  });

  it("breaks an action paragraph at a forced marker", () => {
    expect(types("He runs.\n> THE END <")).toEqual(["action", "centered"]);
  });

  it("drops boneyard comments but keeps every later line number", () => {
    const { elements } = parseFountain(
      [
        "/* An old",
        "scene */",
        "",
        "INT. HOUSE - DAY",
        "",
        "He sits. /* cut */ Waits.",
      ].join("\n"),
    );

    expect(elements).toEqual([
      {
        line: 4,
        sceneNumber: null,
        text: "INT. HOUSE - DAY",
        type: "scene-heading",
      },
      { line: 6, text: "He sits.  Waits.", type: "action" },
    ]);
  });

  it("normalizes Windows line endings", () => {
    expect(types("INT. HOUSE - DAY\r\n\r\nHe waits.")).toEqual([
      "scene-heading",
      "action",
    ]);
  });

  it("returns nothing for an empty document", () => {
    expect(parseFountain("")).toEqual({ elements: [], titlePage: [] });
  });
});

describe("hasFountainExtension", () => {
  it("matches .fountain and .spmd in any case", () => {
    expect(hasFountainExtension("Draft.FOUNTAIN")).toBe(true);
    expect(hasFountainExtension("draft.spmd")).toBe(true);
    expect(hasFountainExtension("draft.md")).toBe(false);
  });
});

describe("forced action", () => {
  it("wins over transitions and character cues", () => {
    expect(
      parseFountain("Run.\n\n!CUT TO:\n\nHe waits.").elements[1],
    ).toMatchObject({ text: "CUT TO:", type: "action" });
  });
});
