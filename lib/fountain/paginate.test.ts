import { describe, expect, it } from "vitest";

import {
  countLines,
  formatEighths,
  getEighths,
  LINES_PER_PAGE,
  paginateScreenplay,
  splitText,
} from "@/lib/fountain/paginate";
import { parseFountain } from "@/lib/fountain/parse";

function paginate(source: string) {
  return paginateScreenplay(parseFountain(source));
}

// `count` one-line action paragraphs: each takes its line plus a blank.
function actions(count: number, word = "Beat") {
  return Array.from({ length: count }, (_, index) => `${word} ${index + 1}.`);
}

describe("countLines", () => {
  it("wraps words at the width and keeps explicit line breaks", () => {
    expect(countLines("one two three", 9)).toBe(2);
    expect(countLines("one two\nthree", 60)).toBe(2);
    expect(countLines("", 60)).toBe(1);
  });

  it("hard-breaks words longer than the width", () => {
    expect(countLines("x".repeat(25), 10)).toBe(3);
  });

  it("measures the printed words, not markup or notes", () => {
    expect(
      countLines("**bold** [[a very long note that would wrap]]", 10),
    ).toBe(1);
  });
});

describe("paginateScreenplay", () => {
  it("fills a page to its 55 lines and turns", () => {
    // 28 one-line paragraphs: 28 lines + 27 blanks = 55.
    const { pages } = paginate(actions(29).join("\n\n"));

    expect(LINES_PER_PAGE).toBe(55);
    expect(pages.map((page) => page.items.length)).toEqual([28, 1]);
    expect(pages.map((page) => page.number)).toEqual([1, 2]);
  });

  it("never leaves a scene heading at the foot of a page", () => {
    const source = [
      ...actions(27),
      "INT. HOUSE - DAY",
      "He waits.\nAnd waits.",
    ].join("\n\n");
    const { headingPages, pages } = paginate(source);
    const heading = parseFountain(source).elements[27]!;

    expect(pages[0]!.items).toHaveLength(27);
    expect(pages[1]!.items[0]!.element).toMatchObject({
      text: "INT. HOUSE - DAY",
      type: "scene-heading",
    });
    expect(headingPages.get(pages[1]!.items[0]!.element)).toBe(2);
    expect(heading.type).toBe("scene-heading");
  });

  it("splits a long action paragraph after a sentence", () => {
    const sentence = "The rain keeps falling on the empty street outside.";
    const paragraph = Array.from({ length: 6 }, () => sentence).join(" ");
    // 26 paragraphs use 51 lines, leaving 3 after the blank line.
    const { pages } = paginate([...actions(26), paragraph].join("\n\n"));
    const [head, tail] = [pages[0]!.items.at(-1)!, pages[1]!.items[0]!];

    expect(head.element.type).toBe("action");
    expect(countLines((head.element as { text: string }).text, 60)).toBe(3);
    expect((head.element as { text: string }).text.endsWith(".")).toBe(true);
    expect(tail).toMatchObject({ continued: true });
    expect(
      `${(head.element as { text: string }).text} ${(tail.element as { text: string }).text}`,
    ).toBe(paragraph);
  });

  it("moves a paragraph whole when a split would strand one line", () => {
    const paragraph =
      "One line here. And a second sentence that is long enough to wrap onto a second line here.";
    // 27 paragraphs use 53 lines, leaving 1 after the blank line.
    const { pages } = paginate([...actions(27), paragraph].join("\n\n"));

    expect(pages[0]!.items).toHaveLength(27);
    expect(pages[1]!.items[0]!.continued).toBeFalsy();
  });

  it("splits a speech with (MORE) and continues it with (CONT'D)", () => {
    const speech = Array.from(
      { length: 8 },
      (_, index) => `This is sentence number ${index + 1} of my speech.`,
    ).join(" ");
    const { pages } = paginate(
      [...actions(24), `BRICK\n(quietly)\n${speech}`].join("\n\n"),
    );
    const head = pages[0]!.items.at(-1)!;
    const tail = pages[1]!.items[0]!;

    expect(head).toMatchObject({ more: true });
    expect(tail).toMatchObject({ continued: true });
    expect(head.element).toMatchObject({
      character: "BRICK",
      runs: [{ type: "parenthetical" }, { type: "dialogue" }],
    });
    expect(tail.element).toMatchObject({
      character: "BRICK",
      runs: [{ type: "dialogue" }],
    });
  });

  it("never ends a page on a parenthetical", () => {
    const { pages } = paginate(
      [
        ...actions(23),
        "BRICK\nFirst line.\nSecond line.\n(beat)\nThird line of a long speech that goes on.\nAnd more.\nAnd more again here.",
      ].join("\n\n"),
    );
    const head = pages[0]!.items.at(-1)!.element;

    expect(head.type).toBe("dialogue");
    expect((head as { runs: { type: string }[] }).runs.at(-1)!.type).not.toBe(
      "parenthetical",
    );
  });

  it("starts a new page at a forced page break", () => {
    const { pages } = paginate("He waits.\n\n===\n\nHe leaves.");

    expect(pages).toHaveLength(2);
  });

  it("carries sections and synopses with the next printed element", () => {
    const source = [
      ...actions(28),
      "# Act Two",
      "= Things go wrong.",
      "Boom.",
    ].join("\n\n");
    const { headingPages, pages } = paginate(source);
    const section = parseFountain(source).elements[28]!;

    expect(pages[1]!.items.map((item) => item.element.type)).toEqual([
      "section",
      "synopsis",
      "action",
    ]);
    expect(section.type).toBe("section");
    expect(headingPages.get(pages[1]!.items[0]!.element)).toBe(2);
  });

  it("keeps a trailing section on the last page", () => {
    const { pages } = paginate("He waits.\n\n# The End");

    expect(pages).toHaveLength(1);
    expect(pages[0]!.items.map((item) => item.element.type)).toEqual([
      "action",
      "section",
    ]);
  });

  it("returns no pages for a title page alone", () => {
    expect(paginate("Title: Heat").pages).toEqual([]);
  });
});

describe("splitText", () => {
  it("returns null when no sentence leaves two lines on each side", () => {
    expect(splitText("Short. Text.", 60, 5)).toBeNull();
  });

  it("forced, falls back to the last word that fits", () => {
    const text = Array.from({ length: 40 }, () => "word").join(" ");

    expect(splitText(text, 10, 3, true)).toMatchObject({
      head: "word word\\nword word\\nword word".replaceAll("\\n", " "),
    });
  });
});

describe("scene lengths", () => {
  it("counts each scene's printed lines, not the space a page turn leaves", () => {
    const source = [
      "INT. HOUSE - DAY",
      ...actions(26),
      "EXT. GARDEN - NIGHT",
      "He leaves.\nSlowly.",
    ].join("\n\n");
    const screenplay = parseFountain(source);
    const { sceneLines } = paginateScreenplay(screenplay);
    const [house, garden] = screenplay.elements.filter(
      (element) => element.type === "scene-heading",
    );

    // Heading + 26 paragraphs, each after a blank line.
    expect(sceneLines.get(house!)).toBe(1 + 26 * 2);
    // Moved to page 2 whole: heading, blank, two lines.
    expect(sceneLines.get(garden!)).toBe(4);
  });

  it("includes a split speech's (MORE) line", () => {
    const speech = Array.from(
      { length: 8 },
      (_, index) => `This is sentence number ${index + 1} of my speech.`,
    ).join(" ");
    const screenplay = parseFountain(
      ["INT. HOUSE - DAY", ...actions(23), `BRICK\n${speech}`].join("\n\n"),
    );
    const { pages, sceneLines } = paginateScreenplay(screenplay);
    const printed = pages
      .flatMap((page) => page.items)
      .filter((item) => item.element.type === "dialogue");

    expect(printed).toHaveLength(2);
    expect(sceneLines.get(screenplay.elements[0]!)).toBeGreaterThan(
      LINES_PER_PAGE,
    );
  });
});

describe("eighths", () => {
  it("rounds lines to eighths of a page, never below one", () => {
    expect(getEighths(1)).toBe(1);
    expect(getEighths(LINES_PER_PAGE)).toBe(8);
    expect(getEighths(Math.round(LINES_PER_PAGE * 1.5))).toBe(12);
  });

  it("formats eighths the way a breakdown sheet does", () => {
    expect(formatEighths(3)).toBe("3/8");
    expect(formatEighths(8)).toBe("1");
    expect(formatEighths(19)).toBe("2 3/8");
    expect(formatEighths(4)).toBe("4/8");
  });
});
