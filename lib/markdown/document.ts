import { hasFountainExtension } from "@/lib/fountain/parse";
import { hasMermaidExtension } from "@/lib/markdown/mermaid";
import { toPlainSpeechText } from "@/lib/markdown/speech";
import type {
  LoadedFile,
  ReaderState,
  ReaderTab,
  ReaderView,
} from "@/lib/markdown/types";

export function isMarkdownFile(file: File) {
  const normalizedName = file.name.toLowerCase();
  const hasMarkdownExtension =
    normalizedName.endsWith(".md") ||
    normalizedName.endsWith(".markdown") ||
    normalizedName.endsWith(".mdown") ||
    normalizedName.endsWith(".mkd");

  return (
    hasMarkdownExtension ||
    file.type === "text/markdown" ||
    file.type === "text/plain"
  );
}

export function isMermaidFile(file: File) {
  return hasMermaidExtension(file.name);
}

export function isFountainFile(file: File) {
  return hasFountainExtension(file.name);
}

export function isPdfFile(file: File) {
  return (
    file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf"
  );
}

export function isSupportedDocumentFile(file: File) {
  return (
    isMarkdownFile(file) ||
    isMermaidFile(file) ||
    isFountainFile(file) ||
    isPdfFile(file)
  );
}

// PDFs pair the reader with their original pages; Markdown and screenplays
// pair it with their editable source.
export function getReaderViewForValue(
  value: unknown,
  file: LoadedFile | null,
): ReaderView {
  if (value === "original" && file?.kind === "pdf") {
    return "original";
  }

  if (value === "source" && file && file.kind !== "pdf") {
    return "source";
  }

  return "preview";
}

export function createDocumentId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `document-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createReaderTab(): ReaderTab {
  return {
    activeHeadingId: null,
    error: null,
    file: null,
    groupId: null,
    id: createDocumentId(),
    view: "preview",
  };
}

// A fresh tab that already holds a loaded document — used when opening several
// files at once, so each file gets its own tab.
export function createLoadedReaderTab(file: LoadedFile): ReaderTab {
  return {
    activeHeadingId: null,
    error: null,
    file,
    groupId: null,
    id: createDocumentId(),
    view: "preview",
  };
}

export function reorderReaderTabs(
  state: ReaderState,
  movedTabId: string,
  targetTabId: string,
  placement: "after" | "before",
): ReaderState {
  const movedIndex = state.tabs.findIndex((tab) => tab.id === movedTabId);
  const targetIndex = state.tabs.findIndex((tab) => tab.id === targetTabId);

  if (
    movedIndex === -1 ||
    targetIndex === -1 ||
    movedTabId === targetTabId
  ) {
    return state;
  }

  const reorderedTabs = [...state.tabs];
  const [movedTab] = reorderedTabs.splice(movedIndex, 1);

  if (!movedTab) {
    return state;
  }

  let insertionIndex = targetIndex + (placement === "after" ? 1 : 0);

  if (movedIndex < insertionIndex) {
    insertionIndex -= 1;
  }

  reorderedTabs.splice(insertionIndex, 0, movedTab);

  if (reorderedTabs.every((tab, index) => tab === state.tabs[index])) {
    return state;
  }

  return {
    ...state,
    tabs: reorderedTabs,
  };
}

// Place imported text into an empty target tab, but never overwrite a document
// that is already open. This keeps app-level paste convenient without turning a
// stray Cmd/Ctrl+V into a destructive action.
export function placeLoadedFileInReaderState(
  state: ReaderState,
  file: LoadedFile,
  targetTabId: string,
): ReaderState {
  const targetTab = state.tabs.find((tab) => tab.id === targetTabId);

  if (targetTab && !targetTab.file) {
    return {
      ...state,
      activeTabId: targetTab.id,
      tabs: state.tabs.map((tab) =>
        tab.id === targetTab.id
          ? {
              ...tab,
              activeHeadingId: null,
              error: null,
              file,
              view: "preview",
            }
          : tab,
      ),
    };
  }

  const nextTab = createLoadedReaderTab(file);

  return {
    ...state,
    activeTabId: nextTab.id,
    tabs: [...state.tabs, nextTab],
  };
}

export function getReaderTabLabel(tab: ReaderTab, index: number) {
  return tab.file?.name ?? `New tab${index > 0 ? ` ${index + 1}` : ""}`;
}

export function isEditablePasteTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function getPastedDocumentName(content: string) {
  const heading = content.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1];
  const baseName = heading
    ? toPlainSpeechText(heading)
        .replace(/[/:*?"<>|]/g, "")
        .trim()
    : "Pasted markdown";

  return `${baseName.slice(0, 48) || "Pasted markdown"}.md`;
}

// Normalize user-authored document names once so the tab label, persisted
// session, file summary, and downloaded filename always agree.
export function normalizeMarkdownDocumentName(name: string) {
  const safeName = name.replace(/[/\\:*?"<>|]/g, "").trim();

  if (!safeName) {
    return null;
  }

  const lowerName = safeName.toLowerCase();
  const hasMarkdownExtension =
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".mdown") ||
    lowerName.endsWith(".mkd") ||
    hasMermaidExtension(safeName);

  return hasMarkdownExtension ? safeName : `${safeName}.md`;
}

export function normalizeDocumentName(
  name: string,
  kind: LoadedFile["kind"],
) {
  if (kind === "markdown") {
    return normalizeMarkdownDocumentName(name);
  }

  const safeName = name.replace(/[/\\:*?"<>|]/g, "").trim();

  if (!safeName) {
    return null;
  }

  if (kind === "screenplay") {
    return hasFountainExtension(safeName) ? safeName : `${safeName}.fountain`;
  }

  return safeName.toLowerCase().endsWith(".pdf")
    ? safeName
    : `${safeName}.pdf`;
}

// Turns a document name into a safe filename for downloading. Screenplays
// download as the Fountain text they hold. Everything else guarantees a
// markdown extension so the saved file opens as markdown: PDF and Mermaid
// documents hold converted Markdown, so their source extension is dropped.
export function getDownloadFileName(
  name: string,
  kind: LoadedFile["kind"] = "markdown",
) {
  if (kind === "screenplay") {
    return normalizeDocumentName(name, "screenplay") ?? "screenplay.fountain";
  }

  const withoutSourceExtension = name.replace(/\.(pdf|mmd|mermaid)$/i, "");

  return normalizeMarkdownDocumentName(withoutSourceExtension) ?? "document.md";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
}
