// Fountain's inline markup: *italic*, **bold**, ***bold italic***,
// _underline_, [[notes]] and backslash escapes. Emphasis never crosses a line
// break; an unmatched marker stays literal text.

export type FountainInline =
  | { type: "text"; value: string }
  | { type: "note"; value: string }
  | {
      children: FountainInline[];
      type: "bold" | "bold-italic" | "italic" | "underline";
    };

const EMPHASIS_TYPES = {
  "*": "italic",
  "**": "bold",
  "***": "bold-italic",
  _: "underline",
} as const;

type EmphasisMarker = keyof typeof EMPHASIS_TYPES;

export function parseFountainInline(text: string): FountainInline[] {
  const nodes: FountainInline[] = [];
  let buffer = "";
  let index = 0;

  const flush = () => {
    if (buffer) {
      nodes.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (index < text.length) {
    const char = text[index]!;

    if (char === "\\" && index + 1 < text.length) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }

    if (text.startsWith("[[", index)) {
      const end = text.indexOf("]]", index + 2);

      if (end !== -1) {
        flush();
        nodes.push({ type: "note", value: text.slice(index + 2, end).trim() });
        index = end + 2;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      const marker = (
        char === "_" ? "_" : getRun(text, index, "*").slice(0, 3)
      ) as EmphasisMarker;
      const contentStart = index + marker.length;
      const close = findClosingMarker(text, contentStart, marker);

      if (close > contentStart) {
        flush();
        nodes.push({
          children: parseFountainInline(text.slice(contentStart, close)),
          type: EMPHASIS_TYPES[marker],
        });
        index = close + marker.length;
        continue;
      }

      buffer += marker;
      index += marker.length;
      continue;
    }

    buffer += char;
    index += 1;
  }

  flush();

  return nodes;
}

// The plain words of a line of Fountain, for speech and word counts. Notes are
// writer annotations, not part of the script, so they are left out.
export function getFountainPlainText(text: string): string {
  return parseFountainInline(text).map(getNodeText).join("");
}

function getNodeText(node: FountainInline): string {
  if (node.type === "text") {
    return node.value;
  }

  if (node.type === "note") {
    return "";
  }

  return node.children.map(getNodeText).join("");
}

function getRun(text: string, start: number, char: string) {
  let end = start;

  while (text[end] === char) {
    end += 1;
  }

  return text.slice(start, end);
}

function findClosingMarker(text: string, from: number, marker: EmphasisMarker) {
  const char = marker[0]!;
  let index = from;

  while (index < text.length && text[index] !== "\n") {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }

    if (text[index] === char) {
      const run = char === "_" ? "_" : getRun(text, index, "*");

      if (run.length === marker.length) {
        return index;
      }

      index += run.length;
      continue;
    }

    index += 1;
  }

  return -1;
}
