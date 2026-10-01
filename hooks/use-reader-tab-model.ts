"use client";

import { useMemo } from "react";

import type { ReadAloudController } from "@/hooks/use-read-aloud";
import {
  getScreenplayBlocks,
  getScreenplayStats,
} from "@/lib/fountain/model";
import { parseFountain } from "@/lib/fountain/parse";
import { parseMarkdown } from "@/lib/markdown/parse";
import {
  getReadableSpeech,
  type SpeechSection,
} from "@/lib/markdown/speech";
import { getDocumentStats } from "@/lib/markdown/stats";
import type {
  DocumentStats,
  HeadingBlock,
  MarkdownBlock,
  ReaderTab,
} from "@/lib/markdown/types";

export type ReaderTabModel = {
  blocks: MarkdownBlock[];
  headings: HeadingBlock[];
  outlineActiveHeadingId: null | string;
  readAloudChunks: string[];
  readAloudChunkLines: number[];
  readAloudSections: SpeechSection[];
  stats: DocumentStats;
};

export function useReaderTabModel(tab: ReaderTab | null): ReaderTabModel {
  const content = tab?.file?.content ?? "";
  const isScreenplay = tab?.file?.kind === "screenplay";
  const activeHeadingId = tab?.activeHeadingId ?? null;
  // Screenplays map onto the same block model: headings drive the outline and
  // spoken blocks drive read-aloud, so both features work unchanged.
  const { blocks, headings, stats } = useMemo(() => {
    if (isScreenplay) {
      const screenplay = parseFountain(content);
      const { headings, spoken } = getScreenplayBlocks(screenplay);

      return {
        blocks: spoken,
        headings,
        stats: getScreenplayStats(screenplay, content),
      };
    }

    const blocks = parseMarkdown(content);

    return {
      blocks,
      headings: blocks.filter((block) => block.type === "heading"),
      stats: getDocumentStats(content),
    };
  }, [content, isScreenplay]);
  const {
    chunkLines: readAloudChunkLines,
    chunks: readAloudChunks,
    sections: readAloudSections,
  } = useMemo(() => {
    const speech = getReadableSpeech(blocks);

    if (!isScreenplay) {
      return speech;
    }

    // Section pickers show the printed scene heading, not its spoken form.
    const printedText = new Map(
      headings.map((heading) => [heading.id, heading.text]),
    );

    return {
      ...speech,
      sections: speech.sections.map((section) => ({
        ...section,
        text: printedText.get(section.id) ?? section.text,
      })),
    };
  }, [blocks, headings, isScreenplay]);
  const outlineActiveHeadingId = useMemo(() => {
    if (
      activeHeadingId &&
      headings.some((heading) => heading.id === activeHeadingId)
    ) {
      return activeHeadingId;
    }

    return headings[0]?.id ?? null;
  }, [activeHeadingId, headings]);

  return {
    blocks,
    headings,
    outlineActiveHeadingId,
    readAloudChunks,
    readAloudChunkLines,
    readAloudSections,
    stats,
  };
}

export function getSpeakingLine(
  reader: ReadAloudController,
  tabId: string,
  chunkLines: number[],
): number | null {
  if (reader.sourceTabId !== tabId) {
    return null;
  }

  if (
    reader.status !== "playing" &&
    reader.status !== "paused" &&
    reader.status !== "loading"
  ) {
    return null;
  }

  return chunkLines[reader.currentIndex] ?? null;
}
