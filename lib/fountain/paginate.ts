import { getFountainPlainText } from "@/lib/fountain/inline";
import type {
  DialogueBlock,
  DialogueRun,
  Screenplay,
  ScreenplayElement,
} from "@/lib/fountain/parse";

// The industry page: US Letter, 12pt Courier at ten characters and six lines
// to the inch, 1.5in left and 1in right margins. One such page is the "one
// page, one minute" of screen time.
export const LINES_PER_PAGE = 55;

const WIDTH = {
  action: 60,
  character: 38,
  dialogue: 35,
  dualDialogue: 28,
  dualParenthetical: 25,
  parenthetical: 25,
} as const;

// Fewest lines a split may leave on either page.
const MIN_SPLIT_LINES = 2;

type DialogueElement = ScreenplayElement & { type: "dialogue" };

// One element as printed on one page. An element split across pages appears
// once per page, holding only that page's part.
export type PageItem = {
  element: ScreenplayElement;
  // A later part of an element that began on an earlier page.
  continued?: boolean;
  // Dialogue that carries on overleaf, printed with (MORE) beneath it.
  more?: boolean;
};

export type ScreenplayPage = {
  items: PageItem[];
  number: number;
};

export type ScreenplayPagination = {
  // The page each section and scene heading prints on, for the outline.
  headingPages: Map<ScreenplayElement, number>;
  pages: ScreenplayPage[];
  // Printed lines each scene takes, from its heading to the next one,
  // keyed by the scene heading. Space left blank by a page turn is not
  // counted.
  sceneLines: Map<ScreenplayElement, number>;
};

export function paginateScreenplay(
  screenplay: Screenplay,
): ScreenplayPagination {
  const pages: ScreenplayPage[] = [];
  const headingPages = new Map<ScreenplayElement, number>();
  const sceneLines = new Map<ScreenplayElement, number>();
  let scene: ScreenplayElement | null = null;
  let items: PageItem[] = [];
  let used = 0;
  // Sections and synopses print nothing, so they wait for the next printed
  // element and travel with it to whichever page it lands on.
  let pending: PageItem[] = [];

  const room = () => LINES_PER_PAGE - used - (used > 0 ? 1 : 0);

  const place = (item: PageItem, lines: number) => {
    for (const waiting of pending) {
      headingPages.set(waiting.element, pages.length + 1);
    }

    const gap = used > 0 ? 1 : 0;

    if (item.element.type === "scene-heading") {
      headingPages.set(item.element, pages.length + 1);
      scene = item.element;
      sceneLines.set(scene, lines);
    } else if (scene) {
      sceneLines.set(scene, sceneLines.get(scene)! + gap + lines);
    }

    used += gap + lines;
    items.push(...pending, item);
    pending = [];
  };

  const turnPage = () => {
    if (items.length > 0) {
      pages.push({ items, number: pages.length + 1 });
      items = [];
      used = 0;
    }
  };

  const { elements } = screenplay;

  for (const [index, element] of elements.entries()) {
    switch (element.type) {
      case "section":
      case "synopsis":
        pending.push({ element });
        continue;
      case "page-break":
        turnPage();
        continue;
      case "action":
        placeAction(element);
        continue;
      case "dialogue":
        placeDialogue(element);
        continue;
      case "scene-heading": {
        // A heading never ends a page: it needs the start of its scene.
        const lines = measure(element);
        const next = getNextPrinted(elements, index);
        const keep = next ? 1 + getMinimumLines(next) : 0;

        if (used > 0 && lines + keep > room()) {
          turnPage();
        }

        place({ element }, lines);
        continue;
      }
      default: {
        const lines = measure(element);

        if (used > 0 && lines > room()) {
          turnPage();
        }

        place({ element }, lines);
      }
    }
  }

  if (pending.length > 0) {
    const lastPage = pages.at(-1);

    if (items.length === 0 && lastPage) {
      for (const waiting of pending) {
        headingPages.set(waiting.element, lastPage.number);
      }

      lastPage.items.push(...pending);
    } else {
      for (const waiting of pending) {
        headingPages.set(waiting.element, pages.length + 1);
      }

      items.push(...pending);
    }
  }

  turnPage();

  return { headingPages, pages, sceneLines };

  function placeAction(element: ScreenplayElement & { type: "action" }) {
    let text = element.text;
    let continued = false;

    for (;;) {
      const lines = countLines(text, WIDTH.action);

      if (lines <= room()) {
        place({ continued, element: { ...element, text } }, lines);
        return;
      }

      const split = splitText(text, WIDTH.action, room(), used === 0);

      if (!split) {
        if (used > 0) {
          turnPage();
          continue;
        }

        place({ continued, element: { ...element, text } }, lines);
        return;
      }

      place(
        { continued, element: { ...element, text: split.head } },
        countLines(split.head, WIDTH.action),
      );
      turnPage();
      text = split.tail;
      continued = true;
    }
  }

  function placeDialogue(element: DialogueElement) {
    let block = element;
    let continued = false;

    for (;;) {
      const lines = measure(block);

      if (lines <= room()) {
        place({ continued, element: block }, lines);
        return;
      }

      const split = splitDialogue(block, room(), used === 0);

      if (!split) {
        if (used > 0) {
          turnPage();
          continue;
        }

        place({ continued, element: block }, lines);
        return;
      }

      const head = { ...block, runs: split.head };

      place({ continued, element: head, more: true }, measure(head) + 1);
      turnPage();
      block = { ...block, runs: split.tail };
      continued = true;
    }
  }
}

// Production measures a scene in eighths of a page, never less than one.
export function getEighths(lines: number) {
  return Math.max(1, Math.round((lines * 8) / LINES_PER_PAGE));
}

// "2 3/8", "6/8", "1". Eighths stay unreduced, as on a breakdown sheet.
export function formatEighths(eighths: number) {
  const pages = Math.floor(eighths / 8);
  const rest = eighths % 8;

  if (pages === 0) {
    return `${rest}/8`;
  }

  return rest === 0 ? `${pages}` : `${pages} ${rest}/8`;
}

// Lines an element takes on the page, without the blank line before it.
function measure(element: ScreenplayElement): number {
  switch (element.type) {
    case "dialogue":
      return measureDialogue(element, false);
    case "dual-dialogue":
      return Math.max(
        measureDialogue(element.left, true),
        measureDialogue(element.right, true),
      );
    case "page-break":
    case "section":
    case "synopsis":
      return 0;
    default:
      return countLines(element.text, WIDTH.action);
  }
}

function measureDialogue(block: DialogueBlock, dual: boolean) {
  return (
    countLines(`${block.character} ${block.extension}`, WIDTH.character) +
    block.runs.reduce((total, run) => total + measureRun(run, dual), 0)
  );
}

function measureRun(run: DialogueRun, dual = false) {
  return countLines(
    run.text,
    run.type === "parenthetical"
      ? dual
        ? WIDTH.dualParenthetical
        : WIDTH.parenthetical
      : dual
        ? WIDTH.dualDialogue
        : WIDTH.dialogue,
  );
}

// The least of an element that must share a page with the heading above it.
function getMinimumLines(element: ScreenplayElement) {
  const lines = measure(element);

  if (element.type === "action") {
    return Math.min(lines, MIN_SPLIT_LINES);
  }

  if (element.type === "dialogue") {
    return Math.min(lines, 1 + MIN_SPLIT_LINES + 1);
  }

  return lines;
}

function getNextPrinted(elements: ScreenplayElement[], index: number) {
  for (const element of elements.slice(index + 1)) {
    if (element.type === "page-break") {
      return null;
    }

    if (element.type !== "section" && element.type !== "synopsis") {
      return element;
    }
  }

  return null;
}

// Splits a speech so this page ends with whole sentences and (MORE). A page
// never ends on a parenthetical or holds a cue with no spoken line under it.
function splitDialogue(block: DialogueElement, room: number, force: boolean) {
  const budget =
    room -
    countLines(`${block.character} ${block.extension}`, WIDTH.character) -
    1;
  const head: DialogueRun[] = [];
  let tail: DialogueRun[] = [];
  let lines = 0;

  for (const [index, run] of block.runs.entries()) {
    const runLines = measureRun(run);

    if (lines + runLines <= budget) {
      head.push(run);
      lines += runLines;
      continue;
    }

    const split =
      run.type === "parenthetical"
        ? null
        : splitText(run.text, WIDTH.dialogue, budget - lines, force);

    if (split) {
      head.push({ ...run, text: split.head });
      tail = [{ ...run, text: split.tail }, ...block.runs.slice(index + 1)];
    } else {
      tail = block.runs.slice(index);
    }

    break;
  }

  while (head.at(-1)?.type === "parenthetical") {
    tail.unshift(head.pop()!);
  }

  const spokenLines = head
    .filter((run) => run.type !== "parenthetical")
    .reduce((total, run) => total + measureRun(run), 0);

  if (
    tail.length === 0 ||
    spokenLines === 0 ||
    (!force && spokenLines < MIN_SPLIT_LINES)
  ) {
    return null;
  }

  return { head, tail };
}

// Splits text after the last sentence (or line break) that fits in `room`,
// leaving at least two lines on each side. Forced, as at the top of an empty
// page, it falls back to the last word that fits.
export function splitText(
  text: string,
  width: number,
  room: number,
  force = false,
) {
  const sentenceCuts = getCuts(text, /[.!?…]["'’”)\]]*( +)|(\n)/g);
  const split =
    findSplit(text, width, room, sentenceCuts, MIN_SPLIT_LINES) ??
    (force ? findSplit(text, width, room, getCuts(text, /( +)/g), 1) : null);

  return split;
}

function getCuts(text: string, pattern: RegExp) {
  return Array.from(text.matchAll(pattern), (match) => {
    const gap = (match[1] ?? match[2] ?? "").length;
    const resume = match.index + match[0].length;

    return { cut: resume - gap, resume };
  });
}

function findSplit(
  text: string,
  width: number,
  room: number,
  cuts: { cut: number; resume: number }[],
  minimum: number,
) {
  for (const { cut, resume } of [...cuts].reverse()) {
    const head = text.slice(0, cut).trimEnd();
    const tail = text.slice(resume);
    const headLines = countLines(head, width);

    if (
      head.trim() &&
      tail.trim() &&
      headLines <= room &&
      headLines >= minimum &&
      countLines(tail, width) >= minimum
    ) {
      return { head, tail };
    }
  }

  return null;
}

// Printed lines of Fountain text at a width in characters: greedy word wrap
// over the plain words, as a typewriter page would set them.
export function countLines(text: string, width: number) {
  return getFountainPlainText(text)
    .split("\n")
    .reduce((total, line) => total + countWrappedLines(line, width), 0);
}

function countWrappedLines(line: string, width: number) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  let lines = 1;
  let length = 0;

  for (const word of words) {
    if (length > 0 && length + 1 + word.length <= width) {
      length += 1 + word.length;
      continue;
    }

    if (length > 0) {
      lines += 1;
    }

    let remaining = word.length;

    while (remaining > width) {
      lines += 1;
      remaining -= width;
    }

    length = remaining;
  }

  return lines;
}
