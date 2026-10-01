import { describe, expect, it } from "vitest";

import {
  createLoadedReaderTab,
  createReaderTab,
  formatBytes,
  getDownloadFileName,
  getPastedDocumentName,
  getReaderTabLabel,
  getReaderViewForValue,
  isFountainFile,
  isMarkdownFile,
  isMermaidFile,
  isPdfFile,
  isSupportedDocumentFile,
  normalizeDocumentName,
  normalizeMarkdownDocumentName,
  placeLoadedFileInReaderState,
  reorderReaderTabs,
} from "@/lib/markdown/document";
import type {
  LoadedFile,
  ReaderState,
  ReaderTab,
} from "@/lib/markdown/types";

const pastedFile: LoadedFile = {
  content: "# Pasted safely",
  kind: "markdown",
  lastModified: 123,
  name: "Pasted safely.md",
  size: 15,
  source: "paste",
};

function createTab(id: string, file: LoadedFile | null): ReaderTab {
  return {
    activeHeadingId: "old-heading",
    error: "old error",
    file,
    groupId: null,
    id,
    view: file ? "source" : "preview",
  };
}

describe("placeLoadedFileInReaderState", () => {
  it("reuses an empty target tab", () => {
    const state: ReaderState = {
      activeTabId: "empty",
      groups: [],
      tabs: [createTab("empty", null)],
    };

    const nextState = placeLoadedFileInReaderState(
      state,
      pastedFile,
      "empty",
    );

    expect(nextState.activeTabId).toBe("empty");
    expect(nextState.tabs).toHaveLength(1);
    expect(nextState.tabs[0]).toMatchObject({
      activeHeadingId: null,
      error: null,
      file: pastedFile,
      view: "preview",
    });
  });

  it("opens a new tab instead of overwriting an existing document", () => {
    const originalFile: LoadedFile = {
      ...pastedFile,
      content: "# Keep me",
      name: "Keep me.md",
    };
    const originalTab = createTab("existing", originalFile);
    const state: ReaderState = {
      activeTabId: originalTab.id,
      groups: [],
      tabs: [originalTab],
    };

    const nextState = placeLoadedFileInReaderState(
      state,
      pastedFile,
      originalTab.id,
    );

    expect(nextState.tabs).toHaveLength(2);
    expect(nextState.tabs[0]).toBe(originalTab);
    expect(nextState.tabs[0]?.file).toBe(originalFile);
    expect(nextState.tabs[1]?.file).toBe(pastedFile);
    expect(nextState.activeTabId).toBe(nextState.tabs[1]?.id);
  });

  it("opens a new tab when the requested target no longer exists", () => {
    const state: ReaderState = {
      activeTabId: "existing",
      groups: [],
      tabs: [createTab("existing", null)],
    };

    const nextState = placeLoadedFileInReaderState(
      state,
      pastedFile,
      "closed-tab",
    );

    expect(nextState.tabs).toHaveLength(2);
    expect(nextState.tabs[0]?.file).toBeNull();
    expect(nextState.tabs[1]?.file).toBe(pastedFile);
  });
});

describe("reorderReaderTabs", () => {
  const tabs = [
    createTab("first", null),
    createTab("second", null),
    createTab("third", null),
  ];
  const state: ReaderState = {
    activeTabId: "second",
    groups: [],
    tabs,
  };

  it("moves a tab before another tab without changing the active tab", () => {
    const nextState = reorderReaderTabs(state, "third", "first", "before");

    expect(nextState.tabs.map((tab) => tab.id)).toEqual([
      "third",
      "first",
      "second",
    ]);
    expect(nextState.activeTabId).toBe("second");
  });

  it("moves a tab after another tab", () => {
    const nextState = reorderReaderTabs(state, "first", "second", "after");

    expect(nextState.tabs.map((tab) => tab.id)).toEqual([
      "second",
      "first",
      "third",
    ]);
  });

  it("returns the same state for a no-op or unknown tab", () => {
    expect(reorderReaderTabs(state, "first", "second", "before")).toBe(
      state,
    );
    expect(reorderReaderTabs(state, "missing", "second", "after")).toBe(
      state,
    );
  });
});

describe("isMarkdownFile", () => {
  it("accepts markdown extensions regardless of case or MIME type", () => {
    expect(isMarkdownFile(new File(["#"], "notes.md"))).toBe(true);
    expect(isMarkdownFile(new File(["#"], "NOTES.MARKDOWN"))).toBe(true);
    expect(isMarkdownFile(new File(["#"], "notes.mdown"))).toBe(true);
    expect(isMarkdownFile(new File(["#"], "notes.mkd"))).toBe(true);
  });

  it("accepts plain-text files and rejects everything else", () => {
    expect(
      isMarkdownFile(new File(["hi"], "readme.txt", { type: "text/plain" })),
    ).toBe(true);
    expect(
      isMarkdownFile(new File([""], "photo.png", { type: "image/png" })),
    ).toBe(false);
    expect(isMarkdownFile(new File([""], "archive.zip"))).toBe(false);
  });
});

describe("isMermaidFile", () => {
  it("accepts Mermaid extensions regardless of case and opens them", () => {
    expect(isMermaidFile(new File(["graph TD"], "flow.mmd"))).toBe(true);
    expect(isMermaidFile(new File(["graph TD"], "FLOW.MERMAID"))).toBe(true);
    expect(isSupportedDocumentFile(new File(["graph TD"], "flow.mmd"))).toBe(
      true,
    );
  });

  it("rejects files that only mention mermaid", () => {
    expect(isMermaidFile(new File([""], "mermaid.md"))).toBe(false);
    expect(isMermaidFile(new File([""], "flow.mmd.txt"))).toBe(false);
  });
});

describe("PDF document detection", () => {
  it("accepts PDF extensions and MIME types", () => {
    expect(isPdfFile(new File([""], "REPORT.PDF"))).toBe(true);
    expect(
      isPdfFile(new File([""], "report", { type: "application/pdf" })),
    ).toBe(true);
    expect(isSupportedDocumentFile(new File([""], "report.pdf"))).toBe(true);
  });

  it("rejects non-PDF files", () => {
    expect(isPdfFile(new File([""], "report.md"))).toBe(false);
  });
});

describe("Fountain document detection", () => {
  it("accepts Fountain extensions, even with a plain-text MIME type", () => {
    const file = new File([""], "Pilot.fountain", { type: "text/plain" });

    expect(isFountainFile(file)).toBe(true);
    expect(isFountainFile(new File([""], "pilot.SPMD"))).toBe(true);
    expect(isSupportedDocumentFile(file)).toBe(true);
  });

  it("rejects other files", () => {
    expect(isFountainFile(new File([""], "pilot.md"))).toBe(false);
  });
});

describe("getReaderViewForValue", () => {
  const screenplay: LoadedFile = {
    content: "INT. HOUSE - DAY",
    kind: "screenplay",
    lastModified: 1,
    name: "pilot.fountain",
    size: 16,
    source: "file",
  };

  it("offers Source for Markdown and screenplays, Original for PDFs", () => {
    expect(getReaderViewForValue("source", screenplay)).toBe("source");
    expect(getReaderViewForValue("source", pastedFile)).toBe("source");
    expect(getReaderViewForValue("original", screenplay)).toBe("preview");
    expect(getReaderViewForValue("source", null)).toBe("preview");
    expect(getReaderViewForValue("anything", screenplay)).toBe("preview");
  });
});

describe("createReaderTab and createLoadedReaderTab", () => {
  it("creates empty preview tabs with unique ids", () => {
    const first = createReaderTab();
    const second = createReaderTab();

    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({
      activeHeadingId: null,
      error: null,
      file: null,
      view: "preview",
    });
    expect(createLoadedReaderTab(pastedFile)).toMatchObject({
      file: pastedFile,
      view: "preview",
    });
  });
});

describe("getReaderTabLabel", () => {
  it("uses the file name when a document is loaded", () => {
    expect(getReaderTabLabel(createTab("a", pastedFile), 0)).toBe(
      "Pasted safely.md",
    );
  });

  it("numbers empty tabs after the first", () => {
    expect(getReaderTabLabel(createTab("a", null), 0)).toBe("New tab");
    expect(getReaderTabLabel(createTab("b", null), 2)).toBe("New tab 3");
  });
});

describe("getPastedDocumentName", () => {
  it("names the document after the first heading, stripped of markup", () => {
    expect(getPastedDocumentName("Intro text\n\n## Release **Notes**\n")).toBe(
      "Release Notes.md",
    );
  });

  it("removes characters that are unsafe in file names", () => {
    expect(getPastedDocumentName('# a/b:c*d?e"f<g>h|i')).toBe("abcdefghi.md");
  });

  it("truncates very long headings to 48 characters", () => {
    const name = getPastedDocumentName(`# ${"long ".repeat(30)}`);

    expect(name.endsWith(".md")).toBe(true);
    expect(name.length).toBe(48 + ".md".length);
  });

  it("falls back for content without a usable heading", () => {
    expect(getPastedDocumentName("just a paragraph")).toBe(
      "Pasted markdown.md",
    );
    expect(getPastedDocumentName("# ***")).toBe("Pasted markdown.md");
  });
});

describe("getDownloadFileName", () => {
  it("keeps existing markdown extensions in any case", () => {
    expect(getDownloadFileName("notes.md")).toBe("notes.md");
    expect(getDownloadFileName("NOTES.MARKDOWN")).toBe("NOTES.MARKDOWN");
  });

  it("appends .md when the extension is missing", () => {
    expect(getDownloadFileName("notes")).toBe("notes.md");
    expect(getDownloadFileName("report.txt")).toBe("report.txt.md");
    expect(getDownloadFileName("report.pdf")).toBe("report.md");
  });

  it("downloads screenplays as Fountain", () => {
    expect(getDownloadFileName("pilot.fountain", "screenplay")).toBe(
      "pilot.fountain",
    );
    expect(getDownloadFileName("Pilot draft", "screenplay")).toBe(
      "Pilot draft.fountain",
    );
    expect(getDownloadFileName("///", "screenplay")).toBe(
      "screenplay.fountain",
    );
  });

  it("downloads Mermaid documents as the Markdown they hold", () => {
    expect(getDownloadFileName("flow.mmd")).toBe("flow.md");
    expect(getDownloadFileName("Flow.MERMAID")).toBe("Flow.md");
  });

  it("strips unsafe characters and falls back to a default name", () => {
    expect(getDownloadFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("abcdefghij.md");
    expect(getDownloadFileName("///")).toBe("document.md");
  });
});

describe("normalizeMarkdownDocumentName", () => {
  it("trims names and adds a markdown extension when needed", () => {
    expect(normalizeMarkdownDocumentName("  Release notes  ")).toBe(
      "Release notes.md",
    );
    expect(normalizeMarkdownDocumentName("report.txt")).toBe("report.txt.md");
  });

  it("preserves supported markdown extensions and their casing", () => {
    expect(normalizeMarkdownDocumentName("README.MD")).toBe("README.MD");
    expect(normalizeMarkdownDocumentName("Guide.markdown")).toBe(
      "Guide.markdown",
    );
    expect(normalizeMarkdownDocumentName("Notes.mdown")).toBe("Notes.mdown");
    expect(normalizeMarkdownDocumentName("Draft.mkd")).toBe("Draft.mkd");
    expect(normalizeMarkdownDocumentName("Flow.mmd")).toBe("Flow.mmd");
    expect(normalizeMarkdownDocumentName("Flow.mermaid")).toBe(
      "Flow.mermaid",
    );
  });

  it("removes unsafe filename characters and rejects empty names", () => {
    expect(normalizeMarkdownDocumentName('a/b:c*d?e"f<g>h|i')).toBe(
      "abcdefghi.md",
    );
    expect(normalizeMarkdownDocumentName("   ")).toBeNull();
    expect(normalizeMarkdownDocumentName("///")).toBeNull();
  });
});

describe("normalizeDocumentName", () => {
  it("preserves the document kind when renaming", () => {
    expect(normalizeDocumentName("Notes", "markdown")).toBe("Notes.md");
    expect(normalizeDocumentName("Research", "pdf")).toBe("Research.pdf");
    expect(normalizeDocumentName("Research.PDF", "pdf")).toBe("Research.PDF");
    expect(normalizeDocumentName("Pilot", "screenplay")).toBe(
      "Pilot.fountain",
    );
    expect(normalizeDocumentName("Pilot.spmd", "screenplay")).toBe(
      "Pilot.spmd",
    );
  });
});

describe("formatBytes", () => {
  it("formats byte counts with the right unit at each boundary", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });
});
