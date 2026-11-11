"use client";

import { useEffect } from "react";

import type {
  ReadAloudController,
  ReadAloudScript,
} from "@/hooks/use-read-aloud";
import { isEditablePasteTarget } from "@/lib/markdown/document";

export function useReadAloudShortcuts({
  activeTabId,
  chunks,
  reader,
  script,
}: {
  activeTabId: string;
  chunks: string[];
  reader: ReadAloudController;
  script?: ReadAloudScript;
}) {
  useEffect(() => {
    const sessionActive =
      reader.sourceTabId != null &&
      reader.total > 0 &&
      (reader.status === "playing" ||
        reader.status === "paused" ||
        reader.status === "loading");

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isReadAloudShortcutTarget(event.target)
      ) {
        return;
      }

      if (event.key === "ArrowLeft" && sessionActive) {
        event.preventDefault();
        reader.seekBy(-1);
      } else if (event.key === "ArrowRight" && sessionActive) {
        event.preventDefault();
        reader.seekBy(1);
      } else if (
        (event.key === " " || event.code === "Space") &&
        !event.repeat &&
        !isSpacebarShortcutTarget(event.target)
      ) {
        if (reader.status === "playing") {
          event.preventDefault();
          reader.pause();
        } else if (reader.status === "paused") {
          event.preventDefault();
          reader.resume();
        } else if (reader.status === "idle" && chunks.length > 0) {
          event.preventDefault();
          reader.startFromSelection(chunks, activeTabId, script);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTabId, chunks, reader, script]);
}

function isReadAloudShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    isEditablePasteTarget(target) ||
    target.closest(
      "select, [role='combobox'], [role='listbox'], [role='menu'], [role='slider']",
    ) !== null
  );
}

function isSpacebarShortcutTarget(target: EventTarget | null) {
  return (
    isReadAloudShortcutTarget(target) ||
    (target instanceof HTMLElement &&
      target.closest(
        "a[href], button, summary, [role='button'], [role='checkbox'], [role='radio'], [role='switch'], [role='tab']",
      ) !== null)
  );
}
