"use client";

import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import {
  MAX_MARKDOWN_FILE_SIZE,
  MAX_OPEN_FILES,
  MAX_PDF_FILE_SIZE,
} from "@/lib/markdown/constants";
import {
  createLoadedReaderTab,
  getDownloadFileName,
  getPastedDocumentName,
  isFountainFile,
  isMermaidFile,
  isPdfFile,
  isSupportedDocumentFile,
  placeLoadedFileInReaderState,
} from "@/lib/markdown/document";
import { toMermaidMarkdown } from "@/lib/markdown/mermaid";
import type {
  LoadedFile,
  ReaderState,
  ReaderTab,
} from "@/lib/markdown/types";
import { importPdfFile, PdfImportError } from "@/lib/pdf/import-pdf";

type CommitOptions = {
  persistImmediately?: boolean;
};

export type DocumentImportProgress = {
  fileCount: number;
  fileIndex: number;
  fileName: string;
  page: number;
  totalPages: number | null;
};

type FileOpenResult =
  | { loaded: LoadedFile; status: "ok" }
  | {
      status:
        | "cancelled"
        | "no-text"
        | "password-protected"
        | "too-large"
        | "unreadable";
    };

export function useMarkdownFiles({
  activeTab,
  commitReaderState,
  getCurrentReaderState,
  updateTab,
}: {
  activeTab: ReaderTab;
  commitReaderState: (
    nextState: ReaderState,
    options?: CommitOptions,
  ) => void;
  getCurrentReaderState: () => ReaderState;
  updateTab: (
    tabId: string,
    updates: Partial<ReaderTab>,
    options?: CommitOptions,
  ) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const importControllerRef = useRef<AbortController | null>(null);
  const [importProgress, setImportProgress] =
    useState<DocumentImportProgress | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function clearFileInput() {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  async function openFiles(fileList: File[]) {
    if (fileList.length === 0) {
      return;
    }

    if (importControllerRef.current) {
      toast.info("A document import is already in progress.");
      return;
    }

    const supportedFiles = fileList.filter(isSupportedDocumentFile);
    const unsupported = fileList.length - supportedFiles.length;
    const overCap = Math.max(0, supportedFiles.length - MAX_OPEN_FILES);
    const candidates = supportedFiles.slice(0, MAX_OPEN_FILES);
    const isSingleSelection = fileList.length === 1;

    if (candidates.length === 0) {
      if (isSingleSelection) {
        updateTab(activeTab.id, {
          error: "Choose a Markdown, Mermaid, Fountain, or PDF document.",
        });
      } else {
        notifySkipped({
          noText: 0,
          overCap,
          passwordProtected: 0,
          tooLarge: 0,
          unreadable: 0,
          unsupported,
        });
      }

      clearFileInput();
      return;
    }

    const controller = new AbortController();
    const results: FileOpenResult[] = [];

    importControllerRef.current = controller;

    try {
      for (const [index, file] of candidates.entries()) {
        const pdf = isPdfFile(file);

        if (
          file.size > (pdf ? MAX_PDF_FILE_SIZE : MAX_MARKDOWN_FILE_SIZE)
        ) {
          results.push({ status: "too-large" });
          continue;
        }

        setImportProgress({
          fileCount: candidates.length,
          fileIndex: index + 1,
          fileName: file.name,
          page: 0,
          totalPages: null,
        });

        try {
          if (pdf) {
            const loaded = await importPdfFile(file, {
              onProgress: ({ page, totalPages }) => {
                setImportProgress({
                  fileCount: candidates.length,
                  fileIndex: index + 1,
                  fileName: file.name,
                  page,
                  totalPages,
                });
              },
              signal: controller.signal,
            });

            results.push({ loaded, status: "ok" });
            continue;
          }

          const text = await file.text();
          const fileDetails = {
            lastModified: file.lastModified,
            name: file.name,
            size: file.size,
            source: "file",
          } as const;

          results.push({
            loaded: isFountainFile(file)
              ? { ...fileDetails, content: text, kind: "screenplay" }
              : {
                  ...fileDetails,
                  content: isMermaidFile(file) ? toMermaidMarkdown(text) : text,
                  kind: "markdown",
                },
            status: "ok",
          });
        } catch (error) {
          if (error instanceof PdfImportError) {
            results.push({
              status: error.code === "invalid" ? "unreadable" : error.code,
            });

            if (error.code === "cancelled") {
              break;
            }
          } else {
            results.push({ status: "unreadable" });
          }
        }
      }
    } finally {
      if (importControllerRef.current === controller) {
        importControllerRef.current = null;
        setImportProgress(null);
      }
    }

    const loaded = results.flatMap((result) =>
      result.status === "ok" ? [result.loaded] : [],
    );
    const tooLarge = results.filter((r) => r.status === "too-large").length;
    const unreadable = results.filter((r) => r.status === "unreadable").length;
    const noText = results.filter((r) => r.status === "no-text").length;
    const passwordProtected = results.filter(
      (r) => r.status === "password-protected",
    ).length;
    const cancelled = results.some((r) => r.status === "cancelled");

    if (loaded.length === 0) {
      if (isSingleSelection) {
        updateTab(activeTab.id, {
          error: getSingleFileError(results[0]?.status, candidates[0]),
        });
      } else {
        notifySkipped({
          noText,
          overCap,
          passwordProtected,
          tooLarge,
          unreadable,
          unsupported,
        });
      }

      if (cancelled) {
        toast.info("Document import cancelled.");
      }

      clearFileInput();
      return;
    }

    // Read state after the async file reads so a concurrent tab switch is
    // respected instead of overwriting a stale snapshot.
    const currentState = getCurrentReaderState();
    const activeIsEmpty =
      currentState.tabs.find((tab) => tab.id === currentState.activeTabId)
        ?.file == null;

    let tabs: ReaderTab[];
    let firstOpenedId: string;

    if (activeIsEmpty) {
      const [firstFile, ...restFiles] = loaded;

      firstOpenedId = currentState.activeTabId;
      tabs = [
        ...currentState.tabs.map((tab) =>
          tab.id === currentState.activeTabId
            ? {
                ...tab,
                activeHeadingId: null,
                error: null,
                file: firstFile,
                view: "preview" as const,
              }
            : tab,
        ),
        ...restFiles.map(createLoadedReaderTab),
      ];
    } else {
      const newTabs = loaded.map(createLoadedReaderTab);

      firstOpenedId = newTabs[0]!.id;
      tabs = [...currentState.tabs, ...newTabs];
    }

    commitReaderState(
      { ...currentState, activeTabId: firstOpenedId, tabs },
      { persistImmediately: true },
    );

    clearFileInput();
    notifySkipped({
      noText,
      overCap,
      passwordProtected,
      tooLarge,
      unreadable,
      unsupported,
    });

    if (cancelled) {
      toast.info("Document import cancelled. Files already read were opened.");
    }
  }

  function loadMarkdownText(content: string, tabId = activeTab.id) {
    if (!content.trim()) {
      updateTab(tabId, {
        error: "The clipboard does not contain any markdown text.",
      });
      return false;
    }

    const size = new Blob([content]).size;

    if (size > MAX_MARKDOWN_FILE_SIZE) {
      updateTab(tabId, {
        error:
          "The pasted markdown is larger than 5 MB. Try a smaller selection.",
      });
      return false;
    }

    const nextFile: LoadedFile = {
      content,
      kind: "markdown",
      lastModified: Date.now(),
      name: getPastedDocumentName(content),
      size,
      source: "paste",
    };
    const nextState = placeLoadedFileInReaderState(
      getCurrentReaderState(),
      nextFile,
      tabId,
    );

    commitReaderState(nextState, { persistImmediately: true });

    return true;
  }

  function openFilePicker() {
    inputRef.current?.click();
  }

  function cancelImport() {
    importControllerRef.current?.abort();
  }

  function downloadDocument() {
    const file = activeTab.file;

    if (!file) {
      return;
    }

    const blob = new Blob([file.content], {
      type:
        file.kind === "screenplay"
          ? "text/plain;charset=utf-8"
          : "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.download = getDownloadFileName(file.name, file.kind);
    anchor.href = url;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (!dragHasFiles(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!dragHasFiles(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!dragHasFiles(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);

    if (dragHasFiles(event)) {
      void openFiles(Array.from(event.dataTransfer.files));
    }
  }

  return {
    cancelImport,
    downloadDocument,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    inputRef,
    importProgress,
    isDragging,
    loadMarkdownText,
    openFilePicker,
    openFiles,
  };
}

function dragHasFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function notifySkipped(counts: {
  noText: number;
  overCap: number;
  passwordProtected: number;
  tooLarge: number;
  unreadable: number;
  unsupported: number;
}) {
  const skipped =
    counts.unsupported +
    counts.tooLarge +
    counts.unreadable +
    counts.noText +
    counts.passwordProtected +
    counts.overCap;

  if (skipped === 0) {
    return;
  }

  const description = [
    counts.unsupported > 0 && `${counts.unsupported} unsupported`,
    counts.tooLarge > 0 && `${counts.tooLarge} over the size limit`,
    counts.unreadable > 0 && `${counts.unreadable} unreadable`,
    counts.noText > 0 && `${counts.noText} without extractable text`,
    counts.passwordProtected > 0 &&
      `${counts.passwordProtected} password-protected`,
    counts.overCap > 0 &&
      `${counts.overCap} over the ${MAX_OPEN_FILES}-file limit`,
  ]
    .filter(Boolean)
    .join(" · ");

  toast.warning(`Skipped ${skipped} file${skipped === 1 ? "" : "s"}`, {
    description,
  });
}

function getSingleFileError(
  status: FileOpenResult["status"] | undefined,
  file: File | undefined,
) {
  if (status === "too-large") {
    if (file && isPdfFile(file)) {
      return "This PDF is larger than 25 MB. Try a smaller document.";
    }

    return file && isFountainFile(file)
      ? "This screenplay is larger than 5 MB. Try a smaller file."
      : "This file is larger than 5 MB. Try a smaller Markdown file.";
  }

  if (status === "no-text") {
    return "This PDF has no extractable text. Scanned PDFs require OCR, which is not supported yet.";
  }

  if (status === "password-protected") {
    return "This PDF is password-protected. Remove the password before opening it.";
  }

  if (status === "cancelled") {
    return "Document import was cancelled.";
  }

  return "The document could not be read. Try exporting it again.";
}
