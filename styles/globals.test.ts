import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8")
  // Comments mention selectors too; only real rules count.
  .replace(/\/\*[\s\S]*?\*\//g, "");

function getSelectorsStyling(pseudo: string) {
  return Array.from(css.matchAll(/([^{};]*)\{/g), (match) => match[1] ?? "")
    .flatMap((list) => list.split(","))
    .map((selector) => selector.trim())
    .filter((selector) => selector.includes(pseudo));
}

describe("read-aloud sentence highlight styles", () => {
  it("are written for every element, not only the root", () => {
    // Firefox (and Zen) paint a ::highlight() style only from a rule matching
    // the element that holds the text. A rule written on :root styles no
    // paragraph there, so the sentence is marked but nothing is drawn.
    const selectors = getSelectorsStyling("::highlight(read-aloud-sentence)");

    expect(selectors.length).toBeGreaterThan(0);

    for (const selector of selectors) {
      expect(selector).toMatch(/(?:^|\s)\*?::highlight\(read-aloud-sentence\)$/);
    }
  });
});
