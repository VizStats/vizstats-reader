import { describe, expect, it } from "vitest";

import {
  createMarkdownSlugger,
  getMarkdownNodeText,
  getMarkdownNodesText,
  type MarkdownAstNode,
} from "@/lib/markdown/ast";

function textNode(value: string): MarkdownAstNode {
  return { type: "text", value };
}

describe("createMarkdownSlugger", () => {
  it("slugs text the way GitHub anchors do", () => {
    const slug = createMarkdownSlugger();

    expect(slug("Hello, World!")).toBe("hello-world");
    expect(slug("  Spaces   everywhere  ")).toBe("spaces-everywhere");
    expect(slug("Use `pnpm dev` locally")).toBe("use-pnpm-dev-locally");
  });

  it("suffixes duplicate slugs with an increasing counter", () => {
    const slug = createMarkdownSlugger();

    expect(slug("Setup")).toBe("setup");
    expect(slug("Setup")).toBe("setup-2");
    expect(slug("Setup")).toBe("setup-3");
  });

  it("falls back to 'section' when nothing sluggable remains", () => {
    const slug = createMarkdownSlugger();

    expect(slug("???")).toBe("section");
    expect(slug("!!!")).toBe("section-2");
  });
});

describe("getMarkdownNodeText", () => {
  it("reads literal values from text and code nodes", () => {
    expect(getMarkdownNodeText(textNode("plain"))).toBe("plain");
    expect(getMarkdownNodeText({ type: "inlineCode", value: "x < y" })).toBe(
      "x < y",
    );
    expect(getMarkdownNodeText({ type: "code", value: "run()" })).toBe(
      "run()",
    );
  });

  it("uses alt text, then title, for images", () => {
    expect(
      getMarkdownNodeText({ alt: "A chart", type: "image", url: "c.png" }),
    ).toBe("A chart");
    expect(
      getMarkdownNodeText({ title: "Fallback", type: "image", url: "c.png" }),
    ).toBe("Fallback");
  });

  it("recurses through container nodes and joins their children", () => {
    const paragraph: MarkdownAstNode = {
      children: [
        { children: [textNode("bold")], type: "strong" },
        // Markdown keeps the spaces between inline pieces in the text nodes.
        textNode(" and "),
        { children: [textNode("linked")], type: "link", url: "https://x" },
        textNode("."),
      ],
      type: "paragraph",
    };

    expect(getMarkdownNodeText(paragraph)).toBe("bold and linked.");
  });

  it("strips tags and decodes entities in raw HTML nodes", () => {
    expect(
      getMarkdownNodeText({
        type: "html",
        value: "<p>Fish &amp; chips<br/>&lt;tag&gt; &quot;quoted&quot;&nbsp;&#39;s</p>",
      }),
    ).toBe("Fish & chips <tag> \"quoted\" 's");
  });

  it("pulls alt text out of HTML img tags", () => {
    expect(
      getMarkdownNodeText({
        type: "html",
        value: '<figure><img src="a.png" alt="First"><img src="b.png" alt=\'Second\'></figure>',
      }),
    ).toBe("First Second");
  });

  it("returns a space for line and thematic breaks, and empty for nothing", () => {
    expect(getMarkdownNodeText({ type: "break" })).toBe(" ");
    expect(getMarkdownNodeText({ type: "thematicBreak" })).toBe(" ");
    expect(getMarkdownNodeText(undefined)).toBe("");
  });
});

describe("getMarkdownNodesText", () => {
  it("joins node texts and collapses the whitespace between them", () => {
    expect(
      getMarkdownNodesText([textNode("one "), textNode(" two"), textNode("")]),
    ).toBe("one two");
    expect(getMarkdownNodesText()).toBe("");
  });
});
