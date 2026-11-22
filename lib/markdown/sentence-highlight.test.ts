import { describe, expect, it } from "vitest";

import {
  findSentenceOffsets,
  splitIntoSentences,
  stripSpokenPrefix,
} from "@/lib/markdown/sentence-highlight";

describe("splitIntoSentences", () => {
  it("splits multi-sentence paragraphs without breaking filenames, decimals, or emails", () => {
    const text =
      "Source matches live. Back end: 46 Python files, PostgreSQL 16.14, and docker-compose.yml. Contact evtdixon@gmail.com for index-I75fUvwv.js details. Not under version control: no git repository on the server.";

    expect(splitIntoSentences(text)).toEqual([
      "Source matches live.",
      "Back end: 46 Python files, PostgreSQL 16.14, and docker-compose.yml.",
      "Contact evtdixon@gmail.com for index-I75fUvwv.js details.",
      "Not under version control: no git repository on the server.",
    ]);
  });

  it("keeps synthetic Item/Quote prefixes attached to the opening sentence", () => {
    expect(
      splitIntoSentences("Item 1. Source matches live. Front end: React."),
    ).toEqual(["Item 1. Source matches live.", "Front end: React."]);

    expect(splitIntoSentences("Quote. Stay curious. Keep reading.")).toEqual([
      "Quote. Stay curious.",
      "Keep reading.",
    ]);
  });

  it("returns an empty list for blank input", () => {
    expect(splitIntoSentences("   ")).toEqual([]);
  });
});

describe("stripSpokenPrefix", () => {
  it("strips spoken list and blockquote prefixes only", () => {
    expect(stripSpokenPrefix("Item 12. Source matches live.")).toBe(
      "Source matches live.",
    );
    expect(stripSpokenPrefix("Quote. Stay curious.")).toBe("Stay curious.");
    expect(stripSpokenPrefix("Front end: React.")).toBe("Front end: React.");
  });
});

describe("findSentenceOffsets", () => {
  it("maps a spoken sentence back to exact raw offsets across collapsed whitespace", () => {
    const haystack =
      "Source matches live.\n  Back end: 46 Python files.\n  Not under version control.";
    const match = findSentenceOffsets(
      haystack,
      "Back end: 46 Python files.",
    );

    expect(match).not.toBeNull();
    expect(haystack.slice(match!.start, match!.end)).toBe(
      "Back end: 46 Python files.",
    );
  });

  it("strips Item N. prefix when matching rendered list item text", () => {
    const haystack = "Source matches live. Front end: 77 TypeScript files.";
    const match = findSentenceOffsets(
      haystack,
      "Item 4. Source matches live.",
    );

    expect(match).not.toBeNull();
    expect(haystack.slice(match!.start, match!.end)).toBe(
      "Source matches live.",
    );
  });

  it("advances to a later occurrence when searchFrom is provided", () => {
    const haystack = "Yes. More detail here. Yes.";
    const first = findSentenceOffsets(haystack, "Yes.", 0);
    const second = findSentenceOffsets(haystack, "Yes.", first!.end);

    expect(first).toEqual({ end: 4, start: 0 });
    expect(second).toEqual({ end: 27, start: 23 });
  });
});
