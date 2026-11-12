import { countFlags } from "@/lib/fountain/flags";
import { getFountainPlainText } from "@/lib/fountain/inline";
import {
  getEighths,
  type ScreenplayPagination,
} from "@/lib/fountain/paginate";
import type {
  DialogueBlock,
  Screenplay,
  ScreenplayElement,
} from "@/lib/fountain/parse";
import { createMarkdownSlugger } from "@/lib/markdown/ast";
import type {
  DocumentStats,
  HeadingBlock,
  MarkdownBlock,
} from "@/lib/markdown/types";

export const SCREENPLAY_HEADING_ID_PREFIX = "screenplay-";

// Element ids the preview, outline, and read-aloud sections share. Sections
// and scene headings are the screenplay's navigable structure.
export function getScreenplayHeadingIds(screenplay: Screenplay) {
  const slug = createMarkdownSlugger();
  const ids = new Map<ScreenplayElement, string>();

  for (const element of screenplay.elements) {
    if (element.type === "section" || element.type === "scene-heading") {
      ids.set(
        element,
        `${SCREENPLAY_HEADING_ID_PREFIX}${slug(getHeadingText(element.text))}`,
      );
    }
  }

  return ids;
}

// Turns a screenplay into the block model the outline and read-aloud already
// understand. Headings carry the printed text for the outline; `spoken` holds
// the matching blocks with text phrased for a voice (INT. becomes Interior,
// cues are announced once per speech, parentheticals are skipped).
// In a table read each character has a voice of their own, so speeches are
// not introduced by the speaker's name.
export function getScreenplayBlocks(
  screenplay: Screenplay,
  pagination?: ScreenplayPagination,
  tableRead = false,
) {
  const ids = getScreenplayHeadingIds(screenplay);
  const headings: HeadingBlock[] = [];
  const spoken: MarkdownBlock[] = [];
  let sectionLevel = 0;
  // Flagged lines count toward the scene or section they sit under.
  let flagCount = 0;
  const closeHeading = () => {
    const heading = headings.at(-1);

    if (heading && flagCount > 0) {
      heading.flags = flagCount;
    }

    flagCount = 0;
  };

  const titleSpeech = getTitlePageSpeech(screenplay);

  if (titleSpeech) {
    spoken.push({
      sourceLine: screenplay.titlePage[0]!.line,
      text: titleSpeech,
      type: "paragraph",
    });
  }

  for (const element of screenplay.elements) {
    const elementFlags = getElementFlags(element);

    switch (element.type) {
      case "section":
      case "scene-heading": {
        const text = getHeadingText(element.text);

        if (!text) {
          break;
        }

        closeHeading();

        if (element.type === "section") {
          sectionLevel = element.level;
        }

        const level =
          element.type === "section"
            ? element.level
            : Math.min(sectionLevel + 1, 6);
        const id = ids.get(element)!;

        const sceneLines = pagination?.sceneLines.get(element);

        headings.push({
          eighths:
            sceneLines === undefined ? undefined : getEighths(sceneLines),
          id,
          level,
          page: pagination?.headingPages.get(element),
          sourceLine: element.line,
          text,
          type: "heading",
        });
        spoken.push({
          id,
          level,
          sourceLine: element.line,
          text:
            element.type === "scene-heading"
              ? speakSceneHeading(text)
              : toSentence(text),
          type: "heading",
        });
        break;
      }
      case "action":
      case "centered":
      case "lyrics":
        pushParagraph(spoken, element.line, getFountainPlainText(element.text));
        break;
      case "transition":
        pushParagraph(
          spoken,
          element.line,
          toSentence(speakCapitals(getFountainPlainText(element.text))),
        );
        break;
      case "dialogue":
        spoken.push(...getDialogueBlocks(element, tableRead));
        break;
      case "dual-dialogue":
        spoken.push(
          ...getDialogueBlocks(element.left, tableRead),
          ...getDialogueBlocks(element.right, tableRead),
        );
        break;
      case "page-break":
        spoken.push({ sourceLine: element.line, type: "hr" });
        break;
      case "synopsis":
        break;
    }

    flagCount += elementFlags;
  }

  closeHeading();

  return { headings, spoken };
}

function getElementFlags(element: ScreenplayElement) {
  switch (element.type) {
    case "dialogue":
      return getDialogueFlags(element);
    case "dual-dialogue":
      return getDialogueFlags(element.left) + getDialogueFlags(element.right);
    case "page-break":
      return 0;
    default:
      return countFlags(element.text);
  }
}

function getDialogueFlags(block: DialogueBlock) {
  return block.runs.reduce((total, run) => total + countFlags(run.text), 0);
}

// A heading's words, without notes or the space they leave behind, so a
// flag or note never changes the heading's id.
function getHeadingText(text: string) {
  return getFountainPlainText(text).replace(/\s+/g, " ").trim();
}

export function getScreenplayStats(
  screenplay: Screenplay,
  content: string,
  pagination?: ScreenplayPagination,
): DocumentStats {
  const words =
    getScreenplayText(screenplay).match(/\b[\w'-]+\b/g)?.length ?? 0;

  return {
    lines: content ? content.replace(/\r\n?/g, "\n").split("\n").length : 0,
    pages: pagination?.pages.length,
    readingMinutes: Math.max(1, Math.ceil(words / 220)),
    scenes: screenplay.elements.filter(
      (element) => element.type === "scene-heading",
    ).length,
    words,
  };
}

function getScreenplayText(screenplay: Screenplay) {
  const parts = screenplay.titlePage.flatMap((entry) => entry.values);

  for (const element of screenplay.elements) {
    switch (element.type) {
      case "dialogue":
        parts.push(...getDialogueText(element));
        break;
      case "dual-dialogue":
        parts.push(
          ...getDialogueText(element.left),
          ...getDialogueText(element.right),
        );
        break;
      case "page-break":
        break;
      default:
        parts.push(element.text);
    }
  }

  return parts.map(getFountainPlainText).join(" ");
}

// "Brick & Steel. Written by Stu Maschwitz." from the title page headline.
function getTitlePageSpeech(screenplay: Screenplay) {
  const valueOf = (...keys: string[]) =>
    screenplay.titlePage
      .filter((entry) => keys.includes(entry.key.toLowerCase()))
      .flatMap((entry) => entry.values.map(getFountainPlainText))
      .join(" ")
      .trim();
  const byline = [valueOf("credit"), valueOf("author", "authors")]
    .filter(Boolean)
    .join(" ");

  return [toSentence(valueOf("title")), toSentence(byline)]
    .filter(Boolean)
    .join(" ");
}

function getDialogueText(block: DialogueBlock) {
  return [block.character, ...block.runs.map((run) => run.text)];
}

function getDialogueBlocks(
  block: DialogueBlock,
  tableRead: boolean,
): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const speaker = getSpeakerName(block.character);
  let announced = tableRead;

  for (const run of block.runs) {
    if (run.type === "parenthetical") {
      continue;
    }

    const text = getFountainPlainText(run.text);

    if (!text.trim()) {
      continue;
    }

    blocks.push({
      sourceLine: run.line,
      speaker,
      text: announced ? text : `${speakName(block.character)}. ${text}`,
      type: "paragraph",
    });
    announced = true;
  }

  return blocks;
}

// One cast entry per character, however the cue is capitalised.
export function getSpeakerName(character: string) {
  return getFountainPlainText(character).trim().toUpperCase();
}

function pushParagraph(blocks: MarkdownBlock[], line: number, text: string) {
  if (text.trim()) {
    blocks.push({ sourceLine: line, text, type: "paragraph" });
  }
}

const SCENE_PREFIXES: [RegExp, string][] = [
  [/^(?:int\.?\/ext|int\/ext|i\/e)(?:\.\s*|\s+)/i, "Interior, exterior. "],
  [/^int(?:\.\s*|\s+)/i, "Interior. "],
  [/^ext(?:\.\s*|\s+)/i, "Exterior. "],
  [/^est(?:\.\s*|\s+)/i, "Establishing. "],
];

function speakSceneHeading(text: string) {
  for (const [pattern, spoken] of SCENE_PREFIXES) {
    if (pattern.test(text)) {
      return `${spoken}${toSentence(speakCapitals(text.replace(pattern, "")))}`;
    }
  }

  return toSentence(speakCapitals(text));
}

// Speech engines spell out short words in capitals, so screenplay capitals are
// read in sentence case. Dashes between heading parts become pauses.
function speakCapitals(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+[-–—]+\s+/g, ", ")
    .replace(/:$/, "");
}

function speakName(name: string) {
  return name
    .toLowerCase()
    .replace(
      /(^|[\s'-])(\p{L})/gu,
      (_, boundary: string, letter: string) =>
        `${boundary}${letter.toUpperCase()}`,
    );
}

function toSentence(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return "";
  }

  const capitalized = `${trimmed[0]!.toUpperCase()}${trimmed.slice(1)}`;

  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}
