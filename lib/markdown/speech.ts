import type { MarkdownBlock } from "@/lib/markdown/types";

const REMEMBERED_SELECTION_MAX_AGE_MS = 10_000;

let rememberedReadableSelection: { text: string; timestamp: number } | null =
  null;

// A heading and the flat chunk index where its section starts, so the reader
// can fast-forward playback to a specific section of the document.
export type SpeechSection = {
  chunkIndex: number;
  id: string;
  level: number;
  text: string;
};

export function getReadableChunks(blocks: MarkdownBlock[]) {
  return getReadableSpeech(blocks).chunks;
}

// A speech chunk paired with the markdown source line of the smallest element
// it came from (the <li>/<tr>/<p>/heading), used to sync the reading highlight.
type ChunkPiece = { line: number; text: string };

// One entry per chunk: the screenplay character who speaks it, or null for
// the narrator (and for every chunk of a Markdown document).
export type ChunkSpeaker = null | string;

// Flattens blocks into speech chunks and, in the same pass, records the chunk
// index at which each heading's section begins and the source line of each chunk.
export function getReadableSpeech(blocks: MarkdownBlock[]): {
  chunkLines: number[];
  chunkSpeakers: ChunkSpeaker[];
  chunks: string[];
  sections: SpeechSection[];
} {
  const chunks: string[] = [];
  const chunkLines: number[] = [];
  const chunkSpeakers: ChunkSpeaker[] = [];
  const sections: SpeechSection[] = [];

  for (const block of blocks) {
    const blockChunks = getBlockChunks(block);

    if (block.type === "heading" && blockChunks.length > 0) {
      sections.push({
        chunkIndex: chunks.length,
        id: block.id,
        level: block.level,
        text: toPlainSpeechText(block.text),
      });
    }

    for (const piece of blockChunks) {
      chunks.push(piece.text);
      chunkLines.push(piece.line);
      chunkSpeakers.push(
        block.type === "paragraph" ? (block.speaker ?? null) : null,
      );
    }
  }

  return { chunkLines, chunkSpeakers, chunks, sections };
}

function getBlockChunks(block: MarkdownBlock): ChunkPiece[] {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return withLine(splitSpeechText(block.text), block.sourceLine);
    case "blockquote":
      return withLine(
        splitSpeechText(`Quote. ${block.text}`),
        block.sourceLine,
      );
    case "list":
      return block.items.flatMap((item, index) =>
        withLine(
          splitSpeechText(`Item ${index + 1}. ${item}`),
          block.itemLines[index] ?? block.sourceLine,
        ),
      );
    case "table": {
      const headers = block.headers.map(toPlainSpeechText);
      const bodyRows =
        block.rows.length > 0
          ? block.rows.map((cells, index) => ({
              cells,
              line: block.rowLines[index] ?? block.sourceLine,
            }))
          : block.headers.length > 0
            ? [{ cells: block.headers, line: block.headerLine }]
            : [];

      return bodyRows.flatMap(({ cells, line }) => {
        const rowText = cells
          .map((cell, index) => {
            const text = toPlainSpeechText(cell);
            const header = headers[index];

            if (!text) {
              return "";
            }

            return header && header !== text ? `${header}: ${text}` : text;
          })
          .filter(Boolean)
          .join(". ");

        return withLine(splitSpeechText(rowText), line);
      });
    }
    case "code":
    case "hr":
      return [];
  }
}

function withLine(texts: string[], line: number): ChunkPiece[] {
  return texts.map((text) => ({ line, text }));
}

function splitSpeechText(text: string) {
  const plainText = toPlainSpeechText(text);

  if (!plainText) {
    return [];
  }

  const sentences = plainText.match(/[^.!?]+[.!?]*/g) ?? [plainText];
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();

    if (!trimmedSentence) {
      continue;
    }

    const nextChunk = currentChunk
      ? `${currentChunk} ${trimmedSentence}`
      : trimmedSentence;

    if (nextChunk.length > 220 && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = trimmedSentence;
    } else {
      currentChunk = nextChunk;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export function toPlainSpeechText(text: string) {
  return text
    .replace(/\r\n?/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getSelectedChunkIndex(chunks: string[]) {
  if (typeof window === "undefined") {
    return null;
  }

  const selection = window.getSelection();
  const selectedSourceText = getRememberedReadableSelection();

  if (
    (!selection ||
      selection.isCollapsed ||
      !selectionWithinReadableRoot(selection)) &&
    !selectedSourceText
  ) {
    return null;
  }

  const selectedText = normalizeSpeechMatch(
    selection &&
      !selection.isCollapsed &&
      selectionWithinReadableRoot(selection)
      ? selection.toString()
      : selectedSourceText,
  );

  if (!selectedText) {
    return null;
  }

  const selectedWords = selectedText.split(" ").filter(Boolean);
  const chunkMatches = chunks.map((chunk, index) => ({
    index,
    text: normalizeSpeechMatch(chunk),
  }));

  const exactMatch = chunkMatches.find(
    (chunk) =>
      chunk.text.includes(selectedText) || selectedText.includes(chunk.text),
  );

  if (exactMatch) {
    return exactMatch.index;
  }

  const selectedPrefix = selectedWords.slice(0, 8).join(" ");
  const prefixMatch = chunkMatches.find(
    (chunk) => selectedPrefix.length > 8 && chunk.text.includes(selectedPrefix),
  );

  if (prefixMatch) {
    return prefixMatch.index;
  }

  const bestMatch = chunkMatches
    .map((chunk) => ({
      index: chunk.index,
      score: getWordOverlapScore(selectedWords, chunk.text),
    }))
    .sort((a, b) => b.score - a.score)[0];

  return bestMatch && bestMatch.score >= 2 ? bestMatch.index : null;
}

export function rememberReadableSelection(text: string) {
  const trimmedText = text.trim();

  rememberedReadableSelection = trimmedText
    ? { text: trimmedText, timestamp: Date.now() }
    : null;
}

function selectionWithinReadableRoot(selection: Selection) {
  return (
    nodeWithinReadableRoot(selection.anchorNode) ||
    nodeWithinReadableRoot(selection.focusNode)
  );
}

function nodeWithinReadableRoot(node: Node | null) {
  if (!node) {
    return false;
  }

  const element =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;

  return Boolean(element?.closest("[data-readable-root]"));
}

function normalizeSpeechMatch(text: string) {
  return toPlainSpeechText(text)
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getRememberedReadableSelection() {
  if (
    !rememberedReadableSelection ||
    Date.now() - rememberedReadableSelection.timestamp >
      REMEMBERED_SELECTION_MAX_AGE_MS
  ) {
    rememberedReadableSelection = null;

    return "";
  }

  return rememberedReadableSelection.text;
}

function getWordOverlapScore(selectedWords: string[], chunkText: string) {
  const chunkWords = new Set(chunkText.split(" ").filter(Boolean));

  return selectedWords.reduce(
    (score, word) => (chunkWords.has(word) ? score + 1 : score),
    0,
  );
}
