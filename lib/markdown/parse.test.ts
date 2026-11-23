import { describe, expect, it } from "vitest";

import { parseMarkdown } from "@/lib/markdown/parse";

describe("parseMarkdown", () => {
  it("turns headings into blocks with prefixed slug ids and levels", () => {
    const blocks = parseMarkdown("# Getting Started\n\n### Deep Dive");

    expect(blocks).toEqual([
      {
        id: "user-content-getting-started",
        level: 1,
        sourceLine: 1,
        text: "Getting Started",
        type: "heading",
      },
      {
        id: "user-content-deep-dive",
        level: 3,
        sourceLine: 3,
        text: "Deep Dive",
        type: "heading",
      },
    ]);
  });

  it("deduplicates repeated heading slugs", () => {
    const blocks = parseMarkdown("# Setup\n\n# Setup\n\n# Setup");

    expect(
      blocks.map((block) => (block.type === "heading" ? block.id : null)),
    ).toEqual([
      "user-content-setup",
      "user-content-setup-2",
      "user-content-setup-3",
    ]);
  });

  it("drops headings and paragraphs with no readable text", () => {
    expect(parseMarkdown("#")).toEqual([]);
    expect(parseMarkdown("![](image.png)")).toEqual([]);
  });

  it("flattens inline markup into plain paragraph text", () => {
    const blocks = parseMarkdown(
      "Read the **docs** at [our site](https://example.com) using `pnpm`.",
    );

    expect(blocks).toEqual([
      {
        sourceLine: 1,
        text: "Read the docs at our site using pnpm.",
        type: "paragraph",
      },
    ]);
  });

  it("keeps blockquote text together", () => {
    const blocks = parseMarkdown("> Stay curious.\n> Keep reading.");

    expect(blocks).toEqual([
      {
        sourceLine: 1,
        text: "Stay curious. Keep reading.",
        type: "blockquote",
      },
    ]);
  });

  it("preserves code blocks verbatim with their language", () => {
    const blocks = parseMarkdown('```ts\nconst a = "<b>";\n```\n\n```\nplain\n```');

    expect(blocks).toEqual([
      {
        code: 'const a = "<b>";',
        language: "ts",
        sourceLine: 1,
        type: "code",
      },
      { code: "plain", language: "", sourceLine: 5, type: "code" },
    ]);
  });

  it("emits hr blocks for thematic breaks", () => {
    expect(parseMarkdown("above\n\n---\n\nbelow")).toMatchObject([
      { type: "paragraph" },
      { sourceLine: 3, type: "hr" },
      { type: "paragraph" },
    ]);
  });

  it("collects list items with aligned per-item source lines", () => {
    const blocks = parseMarkdown("1. First\n2. Second\n3. Third");

    expect(blocks).toEqual([
      {
        itemLines: [1, 2, 3],
        items: ["First", "Second", "Third"],
        ordered: true,
        sourceLine: 1,
        type: "list",
      },
    ]);
  });

  it("labels task list items as open or completed", () => {
    const blocks = parseMarkdown("- [x] Ship it\n- [ ] Write docs\n- Plain");

    expect(blocks).toEqual([
      {
        itemLines: [1, 2, 3],
        items: [
          "Completed task. Ship it",
          "Open task. Write docs",
          "Plain",
        ],
        ordered: false,
        sourceLine: 1,
        type: "list",
      },
    ]);
  });

  it("parses GFM tables into header and body rows with line info", () => {
    const blocks = parseMarkdown(
      "| Name | Role |\n| --- | --- |\n| Ada | Engineer |\n| Grace | Admiral |",
    );

    expect(blocks).toEqual([
      {
        headerLine: 1,
        headers: ["Name", "Role"],
        rowLines: [3, 4],
        rows: [
          ["Ada", "Engineer"],
          ["Grace", "Admiral"],
        ],
        sourceLine: 1,
        type: "table",
      },
    ]);
  });

  it("keeps a header-only table", () => {
    const blocks = parseMarkdown("| Name | Role |\n| --- | --- |");

    expect(blocks).toEqual([
      {
        headerLine: 1,
        headers: ["Name", "Role"],
        rowLines: [],
        rows: [],
        sourceLine: 1,
        type: "table",
      },
    ]);
  });

  it("reads raw HTML blocks as plain paragraph text", () => {
    const blocks = parseMarkdown(
      '<p>Ampersands &amp; entities</p>\n<img src="chart.png" alt="Quarterly chart">',
    );

    expect(blocks).toEqual([
      {
        sourceLine: 1,
        text: "Quarterly chart Ampersands & entities",
        type: "paragraph",
      },
    ]);
  });

  it("turns footnote definitions into spoken paragraphs", () => {
    const blocks = parseMarkdown("Claim.[^1]\n\n[^1]: The supporting source.");

    expect(blocks).toContainEqual({
      sourceLine: 3,
      text: "Footnote 1. The supporting source.",
      type: "paragraph",
    });
  });

  it("returns an empty list for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
  });
});
