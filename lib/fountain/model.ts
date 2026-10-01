import { getFountainPlainText } from "@/lib/fountain/inline";
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
        `${SCREENPLAY_HEADING_ID_PREFIX}${slug(getFountainPlainText(element.text))}`,
      );
    }
  }

  return ids;
}

// Turns a screenplay into the block model the outline and read-aloud already
// understand. Headings carry the printed text for the outline; `spoken` holds
// the matching blocks with text phrased for a voice (INT. becomes Interior,
// cues are announced once per speech, parentheticals are skipped).
export function getScreenplayBlocks(screenplay: Screenplay) {
  const ids = getScreenplayHeadingIds(screenplay);
  const headings: HeadingBlock[] = [];
  const spoken: MarkdownBlock[] = [];
  let sectionLevel = 0;

  const titleSpeech = getTitlePageSpeech(screenplay);

  if (titleSpeech) {
    spoken.push({
      sourceLine: screenplay.titlePage[0]!.line,
      text: titleSpeech,
      type: "paragraph",
    });
  }

  for (const element of screenplay.elements) {
    switch (element.type) {
      case "section":
      case "scene-heading": {
        const text = getFountainPlainText(element.text);

        if (!text) {
          break;
        }

        if (element.type === "section") {
          sectionLevel = element.level;
        }

        const level =
          element.type === "section"
            ? element.level
            : Math.min(sectionLevel + 1, 6);
        const id = ids.get(element)!;

        headings.push({
          id,
          level,
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
        spoken.push(...getDialogueBlocks(element));
        break;
      case "dual-dialogue":
        spoken.push(
          ...getDialogueBlocks(element.left),
          ...getDialogueBlocks(element.right),
        );
        break;
      case "page-break":
        spoken.push({ sourceLine: element.line, type: "hr" });
        break;
      case "synopsis":
        break;
    }
  }

  return { headings, spoken };
}

export function getScreenplayStats(
  screenplay: Screenplay,
  content: string,
): DocumentStats {
  const words =
    getScreenplayText(screenplay).match(/\b[\w'-]+\b/g)?.length ?? 0;

  return {
    lines: content ? content.replace(/\r\n?/g, "\n").split("\n").length : 0,
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

function getDialogueBlocks(block: DialogueBlock): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let announced = false;

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
      text: announced ? text : `${speakName(block.character)}. ${text}`,
      type: "paragraph",
    });
    announced = true;
  }

  return blocks;
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
