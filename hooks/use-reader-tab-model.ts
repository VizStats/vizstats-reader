"use client";

import { useMemo } from "react";

import type { ReadAloudController } from "@/hooks/use-read-aloud";
import { FLAG_NOTE, getFlagLines } from "@/lib/fountain/flags";
import { getCharacterGenders } from "@/lib/fountain/genders";
import {
  getScreenplayBlocks,
  getScreenplayStats,
} from "@/lib/fountain/model";
import { paginateScreenplay } from "@/lib/fountain/paginate";
import { parseFountain } from "@/lib/fountain/parse";
import { parseMarkdown } from "@/lib/markdown/parse";
import {
  getReadableSpeech,
  type ChunkSpeaker,
  type SpeechSection,
} from "@/lib/markdown/speech";
import { getDocumentStats } from "@/lib/markdown/stats";
import type {
  DocumentStats,
  HeadingBlock,
  MarkdownBlock,
  ReaderTab,
} from "@/lib/markdown/types";
import type { CharacterGender } from "@/lib/speech/cast";

export type ReaderTabModel = {
  blocks: MarkdownBlock[];
  // Screenplays only: each speaking character's gender, where the script
  // gives it, for casting the table read.
  castGenders: Record<string, CharacterGender>;
  headings: HeadingBlock[];
  outlineActiveHeadingId: null | string;
  readAloudChunks: string[];
  readAloudChunkLines: number[];
  // Screenplays only: per passage, the line its flag goes on and whether it
  // is flagged, or null where a passage cannot be flagged.
  readAloudFlagLines: (null | number)[];
  readAloudFlags: (boolean | null)[];
  readAloudSections: SpeechSection[];
  readAloudSpeakers: ChunkSpeaker[];
  stats: DocumentStats;
};

const NO_GENDERS: Record<string, CharacterGender> = {};

export function useReaderTabModel(
  tab: ReaderTab | null,
  tableRead = false,
): ReaderTabModel {
  const content = tab?.file?.content ?? "";
  const isScreenplay = tab?.file?.kind === "screenplay";
  const activeHeadingId = tab?.activeHeadingId ?? null;
  // Screenplays map onto the same block model: headings drive the outline and
  // spoken blocks drive read-aloud, so both features work unchanged.
  const { blocks, castGenders, flagLines, headings, stats } = useMemo(() => {
    if (isScreenplay) {
      const screenplay = parseFountain(content);
      const pagination = paginateScreenplay(screenplay);
      const { headings, spoken } = getScreenplayBlocks(
        screenplay,
        pagination,
        tableRead,
      );

      return {
        blocks: spoken,
        castGenders: getCharacterGenders(screenplay),
        flagLines: getFlagLines(screenplay, content),
        headings,
        stats: getScreenplayStats(screenplay, content, pagination),
      };
    }

    const blocks = parseMarkdown(content);

    return {
      blocks,
      castGenders: NO_GENDERS,
      flagLines: null,
      headings: blocks.filter((block) => block.type === "heading"),
      stats: getDocumentStats(content),
    };
  }, [content, isScreenplay, tableRead]);
  const {
    chunkLines: readAloudChunkLines,
    chunkSpeakers: readAloudSpeakers,
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
  const { readAloudFlagLines, readAloudFlags } = useMemo(() => {
    const sourceLines = flagLines ? content.split("\n") : [];
    const lines = readAloudChunkLines.map(
      (line) => flagLines?.get(line) ?? null,
    );

    return {
      readAloudFlagLines: lines,
      readAloudFlags: lines.map((line) =>
        line === null
          ? null
          : (sourceLines[line - 1]?.includes(FLAG_NOTE) ?? false),
      ),
    };
  }, [content, flagLines, readAloudChunkLines]);
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
    castGenders,
    headings,
    outlineActiveHeadingId,
    readAloudChunks,
    readAloudChunkLines,
    readAloudFlagLines,
    readAloudFlags,
    readAloudSections,
    readAloudSpeakers,
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
