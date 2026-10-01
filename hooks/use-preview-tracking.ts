"use client";

import { useEffect, useRef, type RefObject } from "react";

const USER_SCROLL_PAUSE_MS = 4000;

// Shared by every rendered preview: reports the heading in view to the
// outline and marks the passage being read aloud. Headings carry
// `data-markdown-heading` and an id; readable elements carry
// `data-source-line`.
export function usePreviewTracking(
  articleRef: RefObject<HTMLElement | null>,
  {
    activeSourceLine,
    content,
    onActiveHeadingChange,
  }: {
    activeSourceLine: number | null;
    content: string;
    onActiveHeadingChange: (headingId: string) => void;
  },
) {
  const userScrolledAtRef = useRef(0);

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

    if (activeSourceLine == null) {
      return;
    }

    const target = article.querySelector<HTMLElement>(
      `[data-source-line="${activeSourceLine}"]`,
    );

    if (!target) {
      return;
    }

    target.setAttribute("data-speaking", "true");

    if (Date.now() - userScrolledAtRef.current > USER_SCROLL_PAUSE_MS) {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      target.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "nearest",
      });
    }
  }, [activeSourceLine, articleRef, content]);
}
