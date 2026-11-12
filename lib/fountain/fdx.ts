import { getFountainPlainText } from "@/lib/fountain/inline";
import { SCENE_HEADING } from "@/lib/fountain/parse";
import {
  getChildElement,
  getChildElements,
  getTextContent,
  parseXml,
  XmlParseError,
  type XmlElement,
} from "@/lib/fountain/xml";

// Final Draft (.fdx) scripts open as Fountain: the file's XML is converted
// once, on import, and from then on the screenplay is Fountain text like any
// other, so pages, the outline, the table read, flags and editing all work
// the same. Final Draft's script notes, revision marks and tagging are not
// carried over.

export const FINAL_DRAFT_FILE_EXTENSION = ".fdx";

export function hasFinalDraftExtension(name: string) {
  return name.toLowerCase().endsWith(FINAL_DRAFT_FILE_EXTENSION);
}

export class FinalDraftImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinalDraftImportError";
  }
}

type ElementStyle = {
  alignment: string;
  allCaps: boolean;
  startsNewPage: boolean;
};

type TextRun = {
  bold: boolean;
  italic: boolean;
  text: string;
  underline: boolean;
};

type Block = {
  kind: "action" | "other" | "speech";
  lines: string[];
};

type TitleEntry = { key: string; lines: string[] };

// Final Draft capitalizes these elements unless the script's own element
// settings say otherwise.
const DEFAULT_CAPS_ELEMENTS = new Set([
  "Character",
  "Scene Heading",
  "Shot",
  "Transition",
]);

// Lines Fountain would read as something other than action: forced markers,
// and a "!" the parser would strip.
const FOUNTAIN_MARKER = /^(?:[!@~=#>]|\.(?!\.))/;
const TITLE_PAGE_KEY = /^[A-Za-z][A-Za-z0-9 _-]*:/;
// "Written by", "Story by", "Teleplay by", "Written and directed by", "by".
const CREDIT_WORDS =
  "(?:(?:original|written|screenplay|teleplay|story|script|created|developed|directed|adaptation|and|&)\\s+)*by";
const CREDIT_ONLY = new RegExp(`^${CREDIT_WORDS}:?$`, "i");
const CREDIT_WITH_NAME = new RegExp(`^(${CREDIT_WORDS}):?\\s+(.+)$`, "i");
const SOURCE_LINE = /^(?:based\s+(?:up)?on|adapted\s+from|inspired\s+by)\b/i;
const DRAFT_LINE =
  /\b(?:draft|revis(?:ed|ion)|copyright|wga)\b|©|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b(?:19|20)\d{2}\b/i;

export function convertFinalDraftToFountain(xml: string): string {
  let root: XmlElement;

  try {
    root = parseXml(xml);
  } catch (error) {
    if (error instanceof XmlParseError) {
      throw new FinalDraftImportError("The file is not valid XML.");
    }

    throw error;
  }

  const content = getChildElement(root, "Content");

  if (root.name !== "FinalDraft" || !content) {
    throw new FinalDraftImportError("The file is not a Final Draft script.");
  }

  const titlePageElement = getChildElement(root, "TitlePage");
  const titlePageContent =
    titlePageElement && getChildElement(titlePageElement, "Content");
  const titlePage = titlePageContent
    ? convertTitlePage(getChildElements(titlePageContent, "Paragraph"))
    : [];
  const blocks = convertParagraphs(
    getChildElements(content, "Paragraph"),
    getElementStyles(root),
  );
  const firstBlock = blocks[0];

  // Without a title page, an opening action line such as "NOTE: …" would
  // read as one.
  if (
    titlePage.length === 0 &&
    firstBlock?.kind === "action" &&
    TITLE_PAGE_KEY.test(firstBlock.lines[0]!.trim())
  ) {
    firstBlock.lines[0] = forceAction(firstBlock.lines[0]!);
  }

  if (titlePage.length === 0 && blocks.length === 0) {
    throw new FinalDraftImportError("The script has no text.");
  }

  return `${[
    ...(titlePage.length > 0 ? [formatTitlePage(titlePage)] : []),
    ...blocks.map((block) => block.lines.join("\n")),
  ].join("\n\n")}\n`;
}

function getElementStyles(root: XmlElement) {
  const styles = new Map<string, ElementStyle>();

  for (const settings of getChildElements(root, "ElementSettings")) {
    const type = settings.attributes.Type;

    if (!type) {
      continue;
    }

    const font = getChildElement(settings, "FontSpec");
    const paragraph = getChildElement(settings, "ParagraphSpec");

    styles.set(type, {
      alignment: paragraph?.attributes.Alignment ?? "Left",
      allCaps: hasStyle(font?.attributes.Style, "allcaps"),
      startsNewPage: paragraph?.attributes.StartsNewPage === "Yes",
    });
  }

  return styles;
}

function getParagraphStyle(
  styles: Map<string, ElementStyle>,
  type: string,
  paragraph: XmlElement,
) {
  const base = styles.get(type) ?? {
    alignment: "Left",
    allCaps: DEFAULT_CAPS_ELEMENTS.has(type),
    startsNewPage: false,
  };
  const startsNewPage = paragraph.attributes.StartsNewPage;

  return {
    allCaps: base.allCaps,
    centered: (paragraph.attributes.Alignment ?? base.alignment) === "Center",
    startsNewPage:
      startsNewPage === undefined ? base.startsNewPage : startsNewPage === "Yes",
  };
}

function convertParagraphs(
  paragraphs: XmlElement[],
  styles: Map<string, ElementStyle>,
): Block[] {
  const blocks: Block[] = [];
  let speech: { block: Block; cue: string } | null = null;

  const endSpeech = () => {
    if (speech && speech.block.lines.length > 1) {
      blocks.push(speech.block);
    } else if (speech) {
      // A cue with nothing spoken after it is not dialogue in Fountain.
      blocks.push({ kind: "action", lines: protectAction([speech.cue]) });
    }

    speech = null;
  };

  const pushAction = (text: string, centered: boolean) => {
    const lines = trimBlankLines(text.split("\n"));

    if (lines.length === 0) {
      return;
    }

    if (centered) {
      blocks.push({
        kind: "other",
        lines: lines
          .filter((line) => line.trim())
          .map((line) => `> ${line.trim()} <`),
      });
      return;
    }

    blocks.push({
      kind: "action",
      lines: protectAction(lines.map((line) => (line.trim() ? line : "  "))),
    });
  };

  for (const paragraph of paragraphs) {
    const dual = getChildElement(paragraph, "DualDialogue");

    if (dual) {
      endSpeech();

      const inner = convertParagraphs(
        getChildElements(dual, "Paragraph"),
        styles,
      );
      const second = inner.filter((block) => block.kind === "speech")[1];

      if (second) {
        second.lines[0] += " ^";
      }

      blocks.push(...inner);
      continue;
    }

    const type = paragraph.attributes.Type ?? "General";
    const style = getParagraphStyle(styles, type, paragraph);
    const runs = getTextRuns(paragraph, style.allCaps);
    const plain = runs
      .map((run) => run.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    if (style.startsNewPage && (blocks.length > 0 || speech)) {
      endSpeech();
      blocks.push({ kind: "other", lines: ["==="] });
    }

    switch (type) {
      case "Scene Heading": {
        endSpeech();

        if (plain) {
          blocks.push({
            kind: "other",
            lines: [
              toSceneHeading(escapeText(plain), paragraph.attributes.Number),
            ],
          });
        }

        const summary = getSceneSummary(paragraph);

        if (summary.length > 0) {
          blocks.push({
            kind: "other",
            lines: summary.map((line) => `= ${line}`),
          });
        }

        break;
      }

      case "Character":
        endSpeech();

        if (plain) {
          speech = {
            block: { kind: "speech", lines: [toCue(plain)] },
            cue: escapeText(plain),
          };
        }

        break;

      case "Parenthetical":
        if (!speech) {
          pushAction(formatRuns(runs), style.centered);
        } else if (plain) {
          speech.block.lines.push(
            escapeText(/^\(.*\)$/.test(plain) ? plain : `(${plain})`),
          );
        }

        break;

      case "Dialogue":
        if (speech) {
          speech.block.lines.push(...toSpeechLines(formatRuns(runs)));
        } else {
          pushAction(formatRuns(runs), style.centered);
        }

        break;

      case "Lyrics": {
        const lyrics = trimBlankLines(formatRuns(runs).split("\n"))
          .filter((line) => line.trim())
          .map((line) => `~${line.trim()}`);

        if (speech) {
          speech.block.lines.push(...lyrics);
        } else if (lyrics.length > 0) {
          blocks.push({ kind: "other", lines: lyrics });
        }

        break;
      }

      case "Transition":
        endSpeech();

        if (plain) {
          blocks.push({
            kind: "other",
            lines: [toTransition(escapeText(plain))],
          });
        }

        break;

      // Action, General, Shot, Cast List, act breaks and custom elements.
      default:
        endSpeech();
        pushAction(formatRuns(runs), style.centered);
    }
  }

  endSpeech();

  return blocks;
}

function getTextRuns(paragraph: XmlElement, allCaps: boolean): TextRun[] {
  return getChildElements(paragraph, "Text").map((element) => {
    const style = element.attributes.Style;
    const text = getTextContent(element).replace(/\r\n?/g, "\n");

    return {
      bold: hasStyle(style, "bold"),
      italic: hasStyle(style, "italic"),
      text: allCaps || hasStyle(style, "allcaps") ? text.toUpperCase() : text,
      underline: hasStyle(style, "underline"),
    };
  });
}

function hasStyle(style: string | undefined, name: string) {
  return (style ?? "")
    .split("+")
    .some((part) => part.trim().toLowerCase() === name);
}

// Runs as Fountain text: bold, italic and underline as emphasis markers, and
// Fountain's own markup characters escaped so they stay literal.
function formatRuns(runs: TextRun[]) {
  const merged: TextRun[] = [];

  for (const run of runs) {
    const previous = merged.at(-1);

    if (
      previous &&
      previous.bold === run.bold &&
      previous.italic === run.italic &&
      previous.underline === run.underline
    ) {
      previous.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }

  return merged
    .map((run) =>
      run.text
        .split("\n")
        .map((line) => emphasize(escapeText(line), run))
        .join("\n"),
    )
    .join("");
}

// Emphasis never crosses a line break and sits tight around the words.
function emphasize(line: string, run: TextRun) {
  const stars =
    run.bold && run.italic ? "***" : run.bold ? "**" : run.italic ? "*" : "";
  const underline = run.underline ? "_" : "";
  const match = line.match(/^(\s*)(.*?)(\s*)$/)!;

  if (!(stars || underline) || !match[2]) {
    return line;
  }

  return `${match[1]}${stars}${underline}${match[2]}${underline}${stars}${match[3]}`;
}

function escapeText(text: string) {
  return text.replace(/[\\*_]/g, "\\$&").replace(/\[(?=\[)/g, "\\[");
}

function trimBlankLines(lines: string[]) {
  let start = 0;
  let end = lines.length;

  while (start < end && !lines[start]!.trim()) {
    start += 1;
  }

  while (end > start && !lines[end - 1]!.trim()) {
    end -= 1;
  }

  return lines.slice(start, end);
}

// Action lines Fountain would read as another element are forced with "!".
function protectAction(lines: string[]) {
  return lines.map((line, index) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return line;
    }

    const isForced =
      FOUNTAIN_MARKER.test(trimmed) ||
      (index === 0 &&
        (SCENE_HEADING.test(trimmed) ||
          (lines.length === 1 && isNaturalTransition(trimmed)) ||
          (lines.length > 1 && looksLikeCue(trimmed))));

    return isForced ? forceAction(line) : line;
  });
}

function forceAction(line: string) {
  return line.replace(/^(\s*)/, "$1!");
}

function isNaturalTransition(text: string) {
  return text.endsWith("TO:") && text === text.toUpperCase();
}

function looksLikeCue(text: string) {
  const name = text.replace(/\^$/, "").replace(/\(.*$/, "").trim();

  return /\p{L}/u.test(name) && name === name.toUpperCase();
}

function toSceneHeading(text: string, number: string | undefined) {
  const heading =
    SCENE_HEADING.test(text) && !text.startsWith(".") ? text : `.${text}`;
  const sceneNumber = number?.trim();

  return sceneNumber && /^[\w.-]+$/.test(sceneNumber)
    ? `${heading} #${sceneNumber}#`
    : heading;
}

function toCue(text: string) {
  const isPlainCue =
    looksLikeCue(text) &&
    !FOUNTAIN_MARKER.test(text) &&
    !SCENE_HEADING.test(text);

  return isPlainCue ? text : `@${text}`;
}

function toTransition(text: string) {
  const isPlainTransition =
    isNaturalTransition(text) &&
    !FOUNTAIN_MARKER.test(text) &&
    !SCENE_HEADING.test(text);

  return isPlainTransition ? text : `> ${text}`;
}

// Spoken lines; a blank line inside a speech is kept as two spaces so it
// does not end the speech.
function toSpeechLines(text: string) {
  return trimBlankLines(text.split("\n")).map((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return "  ";
    }

    return trimmed.startsWith("~") ? `\\${trimmed}` : trimmed;
  });
}

// The scene's summary from Final Draft's scene properties, as synopses.
function getSceneSummary(paragraph: XmlElement) {
  const properties = getChildElement(paragraph, "SceneProperties");
  const summary = properties && getChildElement(properties, "Summary");

  if (!summary) {
    return [];
  }

  return getChildElements(summary, "Paragraph")
    .map((line) =>
      getChildElements(line, "Text")
        .map(getTextContent)
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

// Final Draft title pages are free-form paragraphs; Fountain's are keyed.
// Centered text becomes the title, credits, authors and source in the order
// it appears, with draft lines moved to the foot; left-aligned text is the
// contact block and right-aligned text the draft date.
function convertTitlePage(paragraphs: XmlElement[]): TitleEntry[] {
  const centered: string[][] = [[]];
  const contact: string[] = [];
  const draft: string[] = [];

  for (const paragraph of paragraphs) {
    const alignment = paragraph.attributes.Alignment ?? "Left";
    const lines = formatRuns(getTextRuns(paragraph, false))
      .split("\n")
      .map((line) => line.trim());

    for (const line of lines) {
      if (alignment === "Center") {
        if (line) {
          centered.at(-1)!.push(line);
        } else if (centered.at(-1)!.length > 0) {
          centered.push([]);
        }
      } else if (line) {
        (alignment === "Right" ? draft : contact).push(line);
      }
    }
  }

  const entries: TitleEntry[] = [];
  const add = (key: string, line: string) => {
    const last = entries.at(-1);

    if (last?.key === key) {
      last.lines.push(line);
    } else {
      entries.push({ key, lines: [line] });
    }
  };
  const groups = centered.filter((group) => group.length > 0);
  let hasTitle = false;
  let carriedCredit = false;

  // With no centered text at all, the first left-aligned block is the title.
  if (groups.length === 0 && contact.length > 0) {
    groups.push([contact.shift()!]);
  }

  for (const group of groups) {
    const firstLine = getFountainPlainText(group[0]!).trim();

    if (
      !hasTitle &&
      !CREDIT_ONLY.test(firstLine) &&
      !CREDIT_WITH_NAME.test(firstLine) &&
      !SOURCE_LINE.test(firstLine)
    ) {
      hasTitle = true;
      group.forEach((line) => add("Title", line));
      continue;
    }

    hasTitle = true;

    let mode: "author" | "source" | null = carriedCredit ? "author" : null;

    carriedCredit = false;

    for (const [index, line] of group.entries()) {
      const plain = getFountainPlainText(line).trim();
      const credit = plain.match(CREDIT_WITH_NAME);

      if (SOURCE_LINE.test(plain) || mode === "source") {
        add("Source", line);
        mode = "source";
      } else if (CREDIT_ONLY.test(plain)) {
        add("Credit", line);
        mode = "author";
        carriedCredit = index === group.length - 1;
      } else if (credit) {
        add("Credit", escapeText(credit[1]!));
        add("Author", escapeText(credit[2]!));
        mode = "author";
      } else if (mode === "author") {
        add("Author", line);
      } else if (DRAFT_LINE.test(plain)) {
        add("Draft date", line);
      } else {
        add("Source", line);
      }
    }
  }

  draft.forEach((line) => add("Draft date", line));
  contact.forEach((line) => add("Contact", line));

  return entries;
}

function formatTitlePage(entries: TitleEntry[]) {
  return entries
    .map(({ key, lines }) =>
      lines.length === 1
        ? `${key}: ${lines[0]}`
        : [`${key}:`, ...lines.map((line) => `    ${line}`)].join("\n"),
    )
    .join("\n");
}
