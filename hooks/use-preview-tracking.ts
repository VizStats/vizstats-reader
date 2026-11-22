"use client";

import { useEffect, useRef, type RefObject } from "react";

import { createSentenceRange } from "@/lib/markdown/sentence-highlight";

const USER_SCROLL_PAUSE_MS = 4000;
const SENTENCE_HIGHLIGHT_NAME = "read-aloud-sentence";

function supportsCustomHighlights() {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight !== "undefined"
  );
}

function clearSentenceHighlight() {
  if (supportsCustomHighlights()) {
    CSS.highlights.delete(SENTENCE_HIGHLIGHT_NAME);
  }
}

function scrollRangeIntoView(
  article: HTMLElement,
  range: Range,
  reduceMotion: boolean,
) {
  const viewport = article.closest<HTMLElement>(
    "[data-slot='scroll-area-viewport']",
  );
  const rect = range.getBoundingClientRect();

  if (!viewport || rect.height === 0) {
    return;
  }

  const viewportRect = viewport.getBoundingClientRect();
  const topMargin = 48;
  const bottomMargin = 64;

  if (
    rect.top < viewportRect.top + topMargin ||
    rect.bottom > viewportRect.bottom - bottomMargin
  ) {
    const targetTop =
      viewport.scrollTop +
      (rect.top - viewportRect.top) -
      viewportRect.height * 0.35;

    viewport.scrollTo({
      behavior: reduceMotion ? "auto" : "smooth",
      top: Math.max(0, targetTop),
    });
  }
}

// Shared by every rendered preview: reports the heading in view to the
// outline and marks the sentence (or fallback block) being read aloud.
// Headings carry `data-markdown-heading` and an id; readable elements carry
// `data-source-line`.
export function usePreviewTracking(
  articleRef: RefObject<HTMLElement | null>,
  {
    activeSentence = null,
    activeSourceLine,
    content,
    onActiveHeadingChange,
  }: {
    activeSentence?: string | null;
    activeSourceLine: number | null;
    content: string;
    onActiveHeadingChange: (headingId: string) => void;
  },
) {
  const userScrolledAtRef = useRef(0);
  const lastMatchRef = useRef<{ line: number; offset: number } | null>(null);

  useEffect(() => {
    const article = articleRef.current;

    if (!article || typeof IntersectionObserver === "undefined") {
      return;
    }

    const headingElements = Array.from(
      article.querySelectorAll<HTMLElement>("[data-markdown-heading]"),
    );

    if (headingElements.length === 0) {
      return;
    }

    const scrollRoot = article.closest("[data-slot='scroll-area-viewport']");
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleHeading = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];

        if (visibleHeading?.target.id) {
          onActiveHeadingChange(visibleHeading.target.id);
        }
      },
      {
        root: scrollRoot,
        rootMargin: "-12% 0px -72% 0px",
        threshold: [0, 1],
      },
    );

    headingElements.forEach((heading) => observer.observe(heading));

    return () => observer.disconnect();
  }, [articleRef, content, onActiveHeadingChange]);

  // Pause auto-follow briefly after manual scrolling.
  useEffect(() => {
    const article = articleRef.current;
    const viewport = article?.closest("[data-slot='scroll-area-viewport']");

    if (!viewport) {
      return;
    }

    const markUserScroll = () => {
      userScrolledAtRef.current = Date.now();
    };

    viewport.addEventListener("wheel", markUserScroll, { passive: true });
    viewport.addEventListener("touchmove", markUserScroll, { passive: true });
    viewport.addEventListener("keydown", markUserScroll);

    return () => {
      viewport.removeEventListener("wheel", markUserScroll);
      viewport.removeEventListener("touchmove", markUserScroll);
      viewport.removeEventListener("keydown", markUserScroll);
    };
  }, [articleRef, content]);

  useEffect(() => {
    const article = articleRef.current;

    if (!article) {
      return;
    }

    article.querySelector("[data-speaking]")?.removeAttribute("data-speaking");
    clearSentenceHighlight();

    if (activeSourceLine == null) {
      lastMatchRef.current = null;
      return;
    }

    const target = article.querySelector<HTMLElement>(
      `[data-source-line="${activeSourceLine}"]`,
    );

    if (!target) {
      lastMatchRef.current = null;
      return;
    }

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const canAutoScroll =
      Date.now() - userScrolledAtRef.current > USER_SCROLL_PAUSE_MS;

    const searchFrom =
      lastMatchRef.current?.line === activeSourceLine
        ? lastMatchRef.current.offset
        : 0;

    if (activeSentence && supportsCustomHighlights()) {
      const match = createSentenceRange(target, activeSentence, searchFrom);

      if (match) {
        lastMatchRef.current = {
          line: activeSourceLine,
          offset: match.endOffset,
        };
        CSS.highlights.set(SENTENCE_HIGHLIGHT_NAME, new Highlight(match.range));

        if (canAutoScroll) {
          scrollRangeIntoView(article, match.range, reduceMotion);
        }

        return () => {
          clearSentenceHighlight();
        };
      }
    }

    // Fallback when CSS Custom Highlight API is unavailable or spoken text is
    // synthetic (e.g. screenplay scene headings spoken as "Interior. House.").
    lastMatchRef.current = null;
    target.setAttribute("data-speaking", "true");

    if (canAutoScroll) {
      target.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "nearest",
      });
    }

    return () => {
      clearSentenceHighlight();
    };
  }, [activeSentence, activeSourceLine, articleRef, content]);
}
