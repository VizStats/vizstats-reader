import type { DialogueBlock, Screenplay } from "@/lib/fountain/parse";

// Flags mark lines a writer wants to come back to, set while the script is
// read aloud. A flag is an ordinary Fountain note, so it shows in the preview,
// stays off the printed script, and travels with the file to other apps.
export const FLAG_NOTE = "[[Flag]]";

const SCENE_NUMBER_END = /\s*#[\w.-]+#\s*$/;
const CENTERED_CLOSE = /\s*<\s*$/;

// For each line a spoken passage starts on, the line its flag goes on: the
// passage's last line, so the note follows what was read. Natural
// transitions ("CUT TO:") stop being transitions with a note after them, and
// title pages and sections are not the script, so those are left out.
export function getFlagLines(screenplay: Screenplay, source: string) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const flagLines = new Map<number, number>();
  const addSpan = (line: number, text: string) =>
    flagLines.set(line, line + text.split("\n").length - 1);
  const addDialogue = (block: DialogueBlock) => {
    for (const run of block.runs) {
      if (run.type !== "parenthetical") {
        addSpan(run.line, run.text);
      }
    }
  };

  for (const element of screenplay.elements) {
    switch (element.type) {
      case "action":
      case "lyrics":
        addSpan(element.line, element.text);
        break;
      case "scene-heading":
      case "centered":
        flagLines.set(element.line, element.line);
        break;
      case "transition":
        if (lines[element.line - 1]?.trim().startsWith(">")) {
          flagLines.set(element.line, element.line);
        }
        break;
      case "dialogue":
        addDialogue(element);
        break;
      case "dual-dialogue":
        addDialogue(element.left);
        addDialogue(element.right);
        break;
    }
  }

  return flagLines;
}

export function isLineFlagged(source: string, line: number) {
  return getSourceLines(source)[line - 1]?.includes(FLAG_NOTE) ?? false;
}

// Adds a flag to a line, or takes it off again. A flag goes at the end of the
// line, before a scene number or a centering mark so those still work.
export function toggleLineFlag(source: string, line: number) {
  const lines = getSourceLines(source);
  const current = lines[line - 1];

  if (current === undefined) {
    return source;
  }

  const lineEnd = current.endsWith("\r") ? "\r" : "";
  const text = lineEnd ? current.slice(0, -1) : current;

  lines[line - 1] = `${
    text.includes(FLAG_NOTE) ? removeFlag(text) : addFlag(text)
  }${lineEnd}`;

  return lines.join("\n");
}

function addFlag(text: string) {
  const trimmed = text.trimEnd();
  const suffix =
    trimmed.match(SCENE_NUMBER_END)?.[0] ??
    (/^\s*>/.test(trimmed) ? trimmed.match(CENTERED_CLOSE)?.[0] : undefined) ??
    "";
  const body = trimmed.slice(0, trimmed.length - suffix.length);

  return `${body}${body.trim() ? " " : ""}${FLAG_NOTE}${suffix}`;
}

function removeFlag(text: string) {
  return text
    .replace(` ${FLAG_NOTE}`, "")
    .replace(FLAG_NOTE, "");
}

function getSourceLines(source: string) {
  return source.split("\n");
}

export function countFlags(text: string) {
  return text.split(FLAG_NOTE).length - 1;
}
