// `sourceLine` is the 1-based markdown line each block starts on — a stable key
// shared with the react-markdown-rendered DOM (same remark parser), used to sync
// the read-aloud highlight. Lists/tables also carry per-item/per-row lines so the
// highlight can target the specific <li>/<tr> being read.
export type MarkdownBlock = { sourceLine: number } & (
  | {
      id: string;
      level: number;
      text: string;
      type: "heading";
    }
  | {
      text: string;
      type: "paragraph";
    }
  | {
      ordered: boolean;
      items: string[];
      itemLines: number[];
      type: "list";
    }
  | {
      text: string;
      type: "blockquote";
    }
  | {
      code: string;
      language: string;
      type: "code";
    }
  | {
      type: "hr";
    }
  | {
      headerLine: number;
      headers: string[];
      rowLines: number[];
      rows: string[][];
      type: "table";
    }
);

export type HeadingBlock = Extract<MarkdownBlock, { type: "heading" }>;

type LoadedFileBase = {
  content: string;
  lastModified: number;
  name: string;
  size: number;
};

export type LoadedMarkdownFile = LoadedFileBase & {
  kind: "markdown";
  source: "file" | "paste";
};

export type LoadedPdfFile = LoadedFileBase & {
  kind: "pdf";
  originalData: ArrayBuffer;
  pageCount: number;
  source: "file";
};

// A Fountain screenplay. `content` is the original Fountain text, which the
// screenplay preview parses on render and Source view edits directly.
export type LoadedScreenplayFile = LoadedFileBase & {
  kind: "screenplay";
  source: "file";
};

export type LoadedFile =
  | LoadedMarkdownFile
  | LoadedPdfFile
  | LoadedScreenplayFile;

export type ReaderView = "original" | "preview" | "source";

export type ReaderTabGroupColor =
  | "blue"
  | "cyan"
  | "green"
  | "orange"
  | "pink"
  | "purple";

export type ReaderTabGroup = {
  collapsed: boolean;
  color: ReaderTabGroupColor;
  id: string;
  name: string;
};

export type ReaderTab = {
  activeHeadingId: null | string;
  error: null | string;
  file: LoadedFile | null;
  groupId: null | string;
  id: string;
  view: ReaderView;
};

export type ReaderState = {
  activeTabId: string;
  groups: ReaderTabGroup[];
  tabs: ReaderTab[];
};

export type DocumentStats = {
  lines: number;
  readingMinutes: number;
  // Screenplays only: the number of scene headings.
  scenes?: number;
  words: number;
};
