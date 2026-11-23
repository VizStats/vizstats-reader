const SPOKEN_PREFIX = /^(?:Item\s+\d+|Quote)\.\s+/i;

// Intl.Segmenter ends a sentence at any full stop followed by a capital. These
// rarely end one: a title before a name ("Dr. Okafor"), and a lone capital
// initial ("J. Smith", the last letter of "U.S. Treasury").
const TITLE_BEFORE_NAME =
  /(?:^|\s)(?:Mr|Mrs|Ms|Mx|Dr|Prof|St|Mt|Gen|Sen|Rep|Gov|Lt|Col|Capt|Sgt|Rev|Hon|vs)\.$/i;
const CAPITAL_INITIAL = /(?:^|[\s.])\p{Lu}\.$/u;

type SegmenterLike = {
  segment(input: string): Iterable<{ segment: string }>;
};

let cachedSegmenter: SegmenterLike | null | undefined;

function getSentenceSegmenter(): SegmenterLike | null {
  if (cachedSegmenter !== undefined) {
    return cachedSegmenter;
  }

  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    cachedSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  } else {
    cachedSegmenter = null;
  }

  return cachedSegmenter;
}

/**
 * Splits a spoken passage into individual sentences while preserving filenames,
 * decimals, emails, and abbreviations (via `Intl.Segmenter`) and keeping
 * synthetic spoken prefixes ("Item 1.", "Quote.") attached to the first real
 * sentence so they are never spoken or highlighted in isolation.
 */
export function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();

  if (!trimmed) {
    return [];
  }

  const segmenter = getSentenceSegmenter();
  const raw = segmenter
    ? Array.from(segmenter.segment(trimmed), (part) => part.segment.trim())
    : (trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [trimmed]).map(
        (part) => part.trim(),
      );

  const nonEmpty = raw.filter(Boolean);

  if (nonEmpty.length <= 1) {
    return nonEmpty;
  }

  const merged: string[] = [];

  for (let i = 0; i < nonEmpty.length; i++) {
    const part = nonEmpty[i]!;

    if (
      i === 0 &&
      /^(?:Item\s+\d+|Quote)\.$/i.test(part) &&
      i + 1 < nonEmpty.length
    ) {
      merged.push(`${part} ${nonEmpty[i + 1]!}`);
      i += 1;
      continue;
    }

    const previous = merged.at(-1);

    if (
      previous !== undefined &&
      (TITLE_BEFORE_NAME.test(previous) || CAPITAL_INITIAL.test(previous))
    ) {
      merged[merged.length - 1] = `${previous} ${part}`;
      continue;
    }

    merged.push(part);
  }

  return merged;
}

/**
 * Removes synthetic spoken-only prefixes ("Item 1. ", "Quote. ") so the
 * remaining sentence matches the rendered text on screen.
 */
export function stripSpokenPrefix(sentence: string): string {
  return sentence.replace(SPOKEN_PREFIX, "").trim();
}

function normalizeWithMap(text: string): {
  map: number[];
  normalized: string;
} {
  let normalized = "";
  const map: number[] = [];
  let pendingSpaceIndex = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (/\s/.test(ch)) {
      if (normalized.length > 0 && pendingSpaceIndex === -1) {
        pendingSpaceIndex = i;
      }

      continue;
    }

    if (pendingSpaceIndex !== -1) {
      normalized += " ";
      map.push(pendingSpaceIndex);
      pendingSpaceIndex = -1;
    }

    normalized += ch;
    map.push(i);
  }

  return { map, normalized };
}

/**
 * Finds the exact raw character offsets of `sentence` inside `haystack`,
 * tolerating collapsed whitespace and case differences across inline elements
 * (`<code>`, `<strong>`, `<a>`).
 */
export function findSentenceOffsets(
  haystack: string,
  sentence: string,
  searchFrom = 0,
): { end: number; start: number } | null {
  const cleaned = stripSpokenPrefix(sentence);

  if (!cleaned || !haystack) {
    return null;
  }

  const { map, normalized: normHaystack } = normalizeWithMap(haystack);
  const { normalized: normNeedle } = normalizeWithMap(cleaned);

  if (!normNeedle || !normHaystack) {
    return null;
  }

  const startNormIndex =
    searchFrom > 0
      ? Math.max(
          0,
          map.findIndex((rawPos) => rawPos >= searchFrom),
        )
      : 0;

  let matchIndex = normHaystack.indexOf(normNeedle, startNormIndex);

  if (matchIndex === -1 && startNormIndex > 0) {
    matchIndex = normHaystack.indexOf(normNeedle);
  }

  if (matchIndex === -1) {
    const lowerHaystack = normHaystack.toLowerCase();
    const lowerNeedle = normNeedle.toLowerCase();

    matchIndex = lowerHaystack.indexOf(lowerNeedle, startNormIndex);

    if (matchIndex === -1 && startNormIndex > 0) {
      matchIndex = lowerHaystack.indexOf(lowerNeedle);
    }
  }

  if (matchIndex === -1) {
    return null;
  }

  const start = map[matchIndex]!;
  const end = map[matchIndex + normNeedle.length - 1]! + 1;

  return { end, start };
}

type TextSegment = {
  end: number;
  node: Text;
  start: number;
};

/**
 * Collects text nodes belonging directly to `target` (excluding nested
 * `[data-source-line]` descendants such as child list items) via `TreeWalker`
 * and returns a DOM `Range` anchored strictly on text nodes.
 */
export function createSentenceRange(
  target: HTMLElement,
  sentence: string,
  searchFrom = 0,
): { endOffset: number; range: Range } | null {
  if (typeof document === "undefined") {
    return null;
  }

  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;

      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }

      const ownerLine = parent.closest("[data-source-line]");

      // Text inside a nested element on another line (a child list item)
      // belongs to that element. Nested elements on the same line (a
      // blockquote's paragraph) are part of this one.
      if (
        ownerLine &&
        ownerLine !== target &&
        ownerLine.getAttribute("data-source-line") !==
          target.getAttribute("data-source-line")
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const segments: TextSegment[] = [];
  let haystack = "";
  let current = walker.nextNode();

  while (current) {
    const textNode = current as Text;
    const value = textNode.data;

    if (value.length > 0) {
      const start = haystack.length;

      haystack += value;
      segments.push({ end: haystack.length, node: textNode, start });
    }

    current = walker.nextNode();
  }

  const offsets = findSentenceOffsets(haystack, sentence, searchFrom);

  if (!offsets) {
    return null;
  }

  const startSeg = segments.find(
    (seg) => offsets.start >= seg.start && offsets.start < seg.end,
  );
  const endSeg = segments.find(
    (seg) => offsets.end > seg.start && offsets.end <= seg.end,
  );

  if (!startSeg || !endSeg) {
    return null;
  }

  const range = new Range();

  range.setStart(startSeg.node, offsets.start - startSeg.start);
  range.setEnd(endSeg.node, offsets.end - endSeg.start);

  return { endOffset: offsets.end, range };
}
