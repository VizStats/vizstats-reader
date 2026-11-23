import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getReadableChunks,
  getReadableSpeech,
  getSelectedChunkIndex,
  rememberReadableSelection,
  toPlainSpeechText,
} from "@/lib/markdown/speech";
import type { MarkdownBlock } from "@/lib/markdown/types";

function heading(text: string, level = 2, sourceLine = 1): MarkdownBlock {
  return {
    id: `user-content-${text.toLowerCase()}`,
    level,
    sourceLine,
    text,
    type: "heading",
  };
}

function paragraph(text: string, sourceLine = 1): MarkdownBlock {
  return { sourceLine, text, type: "paragraph" };
}

describe("getReadableSpeech", () => {
  it("records each heading's section at the chunk index where it starts", () => {
    const { chunks, sections } = getReadableSpeech([
      heading("Intro", 1),
      paragraph("First part."),
      heading("Details", 2),
      paragraph("Second part."),
    ]);

    expect(chunks).toEqual([
      "Intro",
      "First part.",
      "Details",
      "Second part.",
    ]);
    expect(sections).toEqual([
      { chunkIndex: 0, id: "user-content-intro", level: 1, text: "Intro" },
      { chunkIndex: 2, id: "user-content-details", level: 2, text: "Details" },
    ]);
  });

  it("skips sections for headings with no readable text", () => {
    const { chunks, sections } = getReadableSpeech([
      heading("**"),
      paragraph("Body."),
    ]);

    expect(chunks).toEqual(["Body."]);
    expect(sections).toEqual([]);
  });

  it("pairs every chunk with the source line of its origin element", () => {
    const { chunkLines, chunks } = getReadableSpeech([
      paragraph("One.", 3),
      {
        itemLines: [10, 11],
        items: ["Alpha", "Beta"],
        ordered: false,
        sourceLine: 9,
        type: "list",
      },
    ]);

    expect(chunks).toEqual(["One.", "Item 1. Alpha", "Item 2. Beta"]);
    expect(chunkLines).toEqual([3, 10, 11]);
  });

  it("announces blockquotes and numbered list items", () => {
    expect(
      getReadableChunks([
        { sourceLine: 1, text: "Stay curious.", type: "blockquote" },
      ]),
    ).toEqual(["Quote. Stay curious."]);
  });

  it("skips code blocks and thematic breaks", () => {
    expect(
      getReadableChunks([
        { code: "const a = 1;", language: "ts", sourceLine: 1, type: "code" },
        { sourceLine: 2, type: "hr" },
        paragraph("After.", 3),
      ]),
    ).toEqual(["After."]);
  });

  it("reads table rows as header-value pairs", () => {
    const { chunkLines, chunks } = getReadableSpeech([
      {
        headerLine: 1,
        headers: ["Name", "Role"],
        rowLines: [3, 4],
        rows: [
          ["Ada", "Engineer"],
          ["Grace", ""],
        ],
        sourceLine: 1,
        type: "table",
      },
    ]);

    expect(chunks).toEqual(["Name: Ada. Role: Engineer", "Name: Grace"]);
    expect(chunkLines).toEqual([3, 4]);
  });

  it("falls back to reading the header row of a header-only table", () => {
    const { chunkLines, chunks } = getReadableSpeech([
      {
        headerLine: 2,
        headers: ["Name", "Role"],
        rowLines: [],
        rows: [],
        sourceLine: 2,
        type: "table",
      },
    ]);

    expect(chunks).toEqual(["Name. Role"]);
    expect(chunkLines).toEqual([2]);
  });

  it("splits long text into chunks of roughly 220 characters at sentence ends", () => {
    const sentence = `Word ${"word ".repeat(29).trim()}.`;
    const { chunkLines, chunks } = getReadableSpeech([
      paragraph(`${sentence} ${sentence} ${sentence}`, 7),
    ]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 220)).toBe(true);
    expect(chunks.join(" ")).toBe(`${sentence} ${sentence} ${sentence}`);
    expect(chunkLines).toEqual(chunks.map(() => 7));
  });

  it("never splits a single sentence, even past the chunk limit", () => {
    const runOn = "word ".repeat(60).trim();

    expect(getReadableChunks([paragraph(runOn)])).toEqual([runOn]);
  });
});

describe("toPlainSpeechText", () => {
  it("strips markdown syntax while keeping the readable words", () => {
    expect(
      toPlainSpeechText(
        "Read **the** _docs_ at [our site](https://example.com), see ![diagram](d.png) and `pnpm dev`.",
      ),
    ).toBe("Read the docs at our site, see diagram and pnpm dev.");
  });

  it("collapses whitespace and line breaks", () => {
    expect(toPlainSpeechText("one\r\ntwo\rthree   four")).toBe(
      "one two three four",
    );
  });

  it("returns an empty string for markup-only input", () => {
    expect(toPlainSpeechText(" **_~~ ")).toBe("");
  });

  it("keeps underscores and asterisks inside words", () => {
    expect(toPlainSpeechText("Run clean_ports.py on the snake_case files.")).toBe(
      "Run clean_ports.py on the snake_case files.",
    );
  });
});

describe("getSelectedChunkIndex", () => {
  it("returns null outside a browser environment", () => {
    expect(getSelectedChunkIndex(["Some chunk."])).toBeNull();
  });
});

// Drives the chunk-matching heuristics through the remembered-selection path,
// which needs only a window whose live selection is empty.
describe("getSelectedChunkIndex with a remembered selection", () => {
  const chunks = [
    "The quick brown fox jumps over the lazy dog.",
    "Alpha bravo charlie delta echo foxtrot golf hotel india juliet.",
    "Red green blue yellow purple orange.",
  ];

  beforeEach(() => {
    vi.stubGlobal("window", { getSelection: () => null });
  });

  afterEach(() => {
    rememberReadableSelection("");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns null when nothing is selected or remembered", () => {
    expect(getSelectedChunkIndex(chunks)).toBeNull();
  });

  it("finds the chunk containing the selection, ignoring case and punctuation", () => {
    rememberReadableSelection("Quick, BROWN fox!");

    expect(getSelectedChunkIndex(chunks)).toBe(0);
  });

  it("matches a selection that extends past the chunk by its leading words", () => {
    rememberReadableSelection(
      "Alpha bravo charlie delta echo foxtrot golf hotel plus words from the following passage",
    );

    expect(getSelectedChunkIndex(chunks)).toBe(1);
  });

  it("falls back to the chunk sharing the most words", () => {
    rememberReadableSelection("purple then yellow then green elsewhere");

    expect(getSelectedChunkIndex(chunks)).toBe(2);
  });

  it("gives up when the overlap is too weak to trust", () => {
    rememberReadableSelection("zebra xylophone");

    expect(getSelectedChunkIndex(chunks)).toBeNull();
  });

  it("forgets a remembered selection after ten seconds", () => {
    vi.useFakeTimers();
    rememberReadableSelection("quick brown fox");

    vi.advanceTimersByTime(11_000);
    expect(getSelectedChunkIndex(chunks)).toBeNull();
  });
});

describe("chunk breaks", () => {
  it("pauses by what follows: the same paragraph, another block, or a heading", () => {
    const longParagraph = `${"A sentence that keeps going for a while.".repeat(4)} ${"Another one follows it here.".repeat(4)}`;
    const { chunkBreaks, chunks } = getReadableSpeech([
      heading("Intro", 1, 1),
      paragraph(longParagraph, 3),
      paragraph("Short.", 5),
      {
        itemLines: [7, 8],
        items: ["Alpha", "Beta"],
        ordered: false,
        sourceLine: 7,
        type: "list",
      },
      heading("Next", 2, 10),
      paragraph("End.", 12),
    ]);

    // The long paragraph splits into two passages that share its line.
    expect(chunks).toHaveLength(8);
    expect(chunkBreaks).toEqual([
      "section", // heading → paragraph
      "sentence", // within the long paragraph
      "block", // long paragraph → short paragraph
      "block", // paragraph → list
      "block", // item → item
      "section", // list → heading
      "section", // heading → paragraph
      "block", // last passage
    ]);
  });
});

describe("passages from report prose", () => {
  it("still breaks a very long run at its full stops when sentences start in lower case", () => {
    const fragment = `${"word ".repeat(20).trim()}.`;
    const run = Array.from({ length: 8 }, () => fragment).join(" ");
    const chunks = getReadableChunks([paragraph(run)]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 220)).toBe(true);
    expect(chunks.join(" ")).toBe(run);
  });

  it("never splits a passage inside a number, an abbreviation or a quote", () => {
    const { chunks } = getReadableSpeech([
      paragraph(
        'Lending to port projects reached $3.5 billion in 2025, up 12.4% on the year before. Most of it went to three terminals on the west coast. Dr. Okafor, who led the review, called it "the most important single project of the decade." Repayments start in 2027.',
      ),
    ]);

    expect(chunks.join(" ")).toContain("$3.5 billion");
    expect(chunks.join(" ")).toContain("12.4%");
    expect(chunks.join(" ")).toContain("Dr. Okafor");
    expect(chunks.join(" ")).toContain('decade." Repayments');
    expect(chunks.every((chunk) => !/\d\. \d/.test(chunk))).toBe(true);
  });
});
