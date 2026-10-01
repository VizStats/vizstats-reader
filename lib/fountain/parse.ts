// A Fountain screenplay parser (https://fountain.io/syntax). Every element
// keeps the 1-based source line it starts on, the same key the Markdown
// preview uses to sync the read-aloud highlight and the outline.

export type TitlePageEntry = {
  key: string;
  line: number;
  values: string[];
};

export type DialogueRun = {
  line: number;
  text: string;
  type: "dialogue" | "lyric" | "parenthetical";
};

export type DialogueBlock = {
  character: string;
  extension: string;
  line: number;
  runs: DialogueRun[];
};

export type ScreenplayElement = { line: number } & (
  | { level: number; text: string; type: "section" }
  | { sceneNumber: null | string; text: string; type: "scene-heading" }
  | { text: string; type: "action" }
  | { text: string; type: "centered" }
  | { text: string; type: "lyrics" }
  | { text: string; type: "synopsis" }
  | { text: string; type: "transition" }
  | ({ type: "dialogue" } & DialogueBlock)
  | { left: DialogueBlock; right: DialogueBlock; type: "dual-dialogue" }
  | { type: "page-break" }
);

export type Screenplay = {
  elements: ScreenplayElement[];
  titlePage: TitlePageEntry[];
};

export const FOUNTAIN_FILE_EXTENSIONS = [".fountain", ".spmd"] as const;

export function hasFountainExtension(name: string) {
  const lowerName = name.toLowerCase();

  return FOUNTAIN_FILE_EXTENSIONS.some((extension) =>
    lowerName.endsWith(extension),
  );
}

const SCENE_HEADING = /^(?:int\.?\/ext|int\/ext|i\/e|int|ext|est)[.\s]/i;
const SCENE_NUMBER = /\s*#([\w.-]+)#\s*$/;
const PAGE_BREAK = /^\s*={3,}\s*$/;
const SECTION = /^\s*(#+)\s*(.*)$/;
const SYNOPSIS = /^\s*=(?!=)\s*(.*)$/;
const CENTERED = /^\s*>\s*(.*?)\s*<\s*$/;
const FORCED_TRANSITION = /^\s*>\s*(.*)$/;
const PARENTHETICAL = /^\s*\(.*\)\s*$/;
const TITLE_PAGE_KEY = /^([A-Za-z][A-Za-z0-9 _-]*):(.*)$/;
const KNOWN_TITLE_PAGE_KEYS = new Set([
  "author",
  "authors",
  "contact",
  "copyright",
  "credit",
  "date",
  "draft date",
  "notes",
  "revision",
  "source",
  "title",
]);

export function parseFountain(source: string): Screenplay {
  const lines = removeBoneyard(source.replace(/\r\n?/g, "\n")).split("\n");
  const { bodyStart, titlePage } = parseTitlePage(lines);

  return {
    elements: parseBody(lines, bodyStart),
    titlePage,
  };
}

// Boneyard comments are dropped, but their line breaks stay so every later
// element keeps its true source line.
function removeBoneyard(text: string) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, ""),
  );
}

// A line with two or more spaces is an intentional blank inside dialogue or
// action; only a truly empty line separates elements.
function isSeparator(line: string | undefined) {
  return line === undefined || (line.trim() === "" && !/^ {2,}$/.test(line));
}

function parseTitlePage(lines: string[]) {
  const titlePage: TitlePageEntry[] = [];
  const firstLine = lines[0] ?? "";
  const firstKey = firstLine.match(TITLE_PAGE_KEY);

  // A known key, or any key with a value on the same line. An opening action
  // line such as "He shouts:" is not a title page.
  if (
    !firstKey ||
    SCENE_HEADING.test(firstLine) ||
    (!KNOWN_TITLE_PAGE_KEYS.has(firstKey[1]!.trim().toLowerCase()) &&
      !firstKey[2]!.trim())
  ) {
    return { bodyStart: 0, titlePage };
  }

  let index = 0;

  for (; index < lines.length && !isSeparator(lines[index]); index += 1) {
    const line = lines[index]!;
    const keyMatch = /^\s/.test(line) ? null : line.match(TITLE_PAGE_KEY);

    if (keyMatch) {
      const value = keyMatch[2]!.trim();

      titlePage.push({
        key: keyMatch[1]!.trim(),
        line: index + 1,
        values: value ? [value] : [],
      });
    } else if (line.trim()) {
      titlePage.at(-1)?.values.push(line.trim());
    }
  }

  return { bodyStart: index, titlePage };
}

function parseBody(lines: string[], start: number) {
  const elements: ScreenplayElement[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index]!;

    if (isSeparator(line)) {
      index += 1;
      continue;
    }

    const lineNumber = index + 1;
    const previousIsBlank = index === start || isSeparator(lines[index - 1]);
    const nextIsBlank = isSeparator(lines[index + 1]);
    const trimmed = line.trim();

    if (PAGE_BREAK.test(line)) {
      elements.push({ line: lineNumber, type: "page-break" });
      index += 1;
      continue;
    }

    const section = line.match(SECTION);

    if (section) {
      elements.push({
        level: Math.min(section[1]!.length, 6),
        line: lineNumber,
        text: section[2]!.trim(),
        type: "section",
      });
      index += 1;
      continue;
    }

    const synopsis = line.match(SYNOPSIS);

    if (synopsis) {
      elements.push({
        line: lineNumber,
        text: synopsis[1]!.trim(),
        type: "synopsis",
      });
      index += 1;
      continue;
    }

    if (
      isForcedSceneHeading(trimmed) ||
      (previousIsBlank && SCENE_HEADING.test(trimmed))
    ) {
      elements.push(getSceneHeading(trimmed, lineNumber));
      index += 1;
      continue;
    }

    const centered = line.match(CENTERED);

    if (centered) {
      elements.push({
        line: lineNumber,
        text: centered[1]!,
        type: "centered",
      });
      index += 1;
      continue;
    }

    const forcedTransition = line.match(FORCED_TRANSITION);

    if (forcedTransition) {
      elements.push({
        line: lineNumber,
        text: forcedTransition[1]!.trim(),
        type: "transition",
      });
      index += 1;
      continue;
    }

    if (
      previousIsBlank &&
      nextIsBlank &&
      !trimmed.startsWith("!") &&
      trimmed.endsWith("TO:") &&
      trimmed === trimmed.toUpperCase()
    ) {
      elements.push({ line: lineNumber, text: trimmed, type: "transition" });
      index += 1;
      continue;
    }

    if (trimmed.startsWith("~")) {
      const lyricLines: string[] = [];

      while (
        index < lines.length &&
        !isSeparator(lines[index]) &&
        lines[index]!.trim().startsWith("~")
      ) {
        lyricLines.push(lines[index]!.trim().slice(1).trim());
        index += 1;
      }

      elements.push({
        line: lineNumber,
        text: lyricLines.join("\n"),
        type: "lyrics",
      });
      continue;
    }

    if (
      previousIsBlank &&
      !nextIsBlank &&
      !trimmed.startsWith("!") &&
      isCharacterCue(trimmed)
    ) {
      const { block, dual, nextIndex } = parseDialogue(lines, index);
      const previous = elements.at(-1);

      if (dual && previous?.type === "dialogue") {
        elements[elements.length - 1] = {
          left: toDialogueBlock(previous),
          line: previous.line,
          right: block,
          type: "dual-dialogue",
        };
      } else {
        elements.push({ ...block, type: "dialogue" });
      }

      index = nextIndex;
      continue;
    }

    const actionLines: string[] = [];

    while (index < lines.length && !isSeparator(lines[index])) {
      const actionLine = lines[index]!;

      if (actionLines.length > 0 && startsNewElement(actionLine)) {
        break;
      }

      actionLines.push(
        actionLine
          .replace(/^(\s*)!/, "$1")
          .replace(/\t/g, "    ")
          .trimEnd(),
      );
      index += 1;
    }

    elements.push({
      line: lineNumber,
      text: actionLines.join("\n"),
      type: "action",
    });
  }

  return elements;
}

function isForcedSceneHeading(trimmed: string) {
  return /^\.[^.]/.test(trimmed);
}

// Forced markers break out of an action paragraph even without a blank line.
function startsNewElement(line: string) {
  const trimmed = line.trim();

  return (
    PAGE_BREAK.test(line) ||
    SECTION.test(line) ||
    SYNOPSIS.test(line) ||
    CENTERED.test(line) ||
    isForcedSceneHeading(trimmed) ||
    (FORCED_TRANSITION.test(line) && !CENTERED.test(line))
  );
}

function getSceneHeading(
  trimmed: string,
  line: number,
): ScreenplayElement & { type: "scene-heading" } {
  const heading = isForcedSceneHeading(trimmed) ? trimmed.slice(1) : trimmed;
  const sceneNumber = heading.match(SCENE_NUMBER)?.[1] ?? null;

  return {
    line,
    sceneNumber,
    text: heading.replace(SCENE_NUMBER, "").trim(),
    type: "scene-heading",
  };
}

// A cue is a line in capitals (extensions such as "(cont'd)" may be any case)
// or any line forced with "@". A trailing "^" marks the second half of dual
// dialogue.
function isCharacterCue(trimmed: string) {
  if (trimmed.startsWith("@")) {
    return trimmed.length > 1;
  }

  const name = trimmed.replace(/\^$/, "").replace(/\(.*$/, "").trim();

  return /\p{L}/u.test(name) && name === name.toUpperCase();
}

function parseDialogue(lines: string[], cueIndex: number) {
  const cue = lines[cueIndex]!.trim().replace(/^@/, "");
  const dual = cue.endsWith("^");
  const cueText = dual ? cue.slice(0, -1).trim() : cue;
  const extensionStart = cueText.indexOf("(");
  const runs: DialogueRun[] = [];
  let index = cueIndex + 1;

  for (; index < lines.length && !isSeparator(lines[index]); index += 1) {
    const raw = lines[index]!;
    const trimmed = raw.trim();
    const type: DialogueRun["type"] = PARENTHETICAL.test(raw)
      ? "parenthetical"
      : trimmed.startsWith("~")
        ? "lyric"
        : "dialogue";
    const text = type === "lyric" ? trimmed.slice(1).trim() : trimmed;
    const previous = runs.at(-1);

    if (previous && type !== "parenthetical" && previous.type === type) {
      previous.text += `\n${text}`;
    } else {
      runs.push({ line: index + 1, text, type });
    }
  }

  return {
    block: {
      character: (extensionStart === -1
        ? cueText
        : cueText.slice(0, extensionStart)
      ).trim(),
      extension:
        extensionStart === -1 ? "" : cueText.slice(extensionStart).trim(),
      line: cueIndex + 1,
      runs,
    } satisfies DialogueBlock,
    dual,
    nextIndex: index,
  };
}

function toDialogueBlock(
  element: ScreenplayElement & { type: "dialogue" },
): DialogueBlock {
  return {
    character: element.character,
    extension: element.extension,
    line: element.line,
    runs: element.runs,
  };
}
