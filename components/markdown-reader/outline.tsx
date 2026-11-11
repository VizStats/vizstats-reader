"use client";

import { ListTree } from "lucide-react";

import { formatEighths } from "@/lib/fountain/paginate";
import type { HeadingBlock } from "@/lib/markdown/types";
import { cn } from "@/lib/utils";

export function Outline({
  activeHeadingId,
  headings,
}: {
  activeHeadingId: null | string;
  headings: HeadingBlock[];
}) {
  // Screenplays add a scene length (in eighths of a page) and a page column.
  const showPages = headings.some((heading) => heading.page);
  const showLengths = headings.some((heading) => heading.eighths);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3 text-card-foreground">
      <div className="flex items-center gap-2 px-1 pb-1">
        <ListTree className="size-4 text-[#03444A] dark:text-[#58D1E2]" />
        <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Outline
        </h2>
        {showPages ? (
          <div
            aria-hidden="true"
            className="flex shrink-0 gap-2 pr-2 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {showLengths ? (
              <span className="w-11 text-right">Length</span>
            ) : null}
            <span className="w-7 text-right">Page</span>
          </div>
        ) : null}
      </div>
      {headings.length > 0 ? (
        <nav className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-auto p-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-muted-foreground/30 scrollbar-hover:scrollbar-thumb-muted-foreground/50">
          {headings.map((heading) => {
            const isActive = heading.id === activeHeadingId;

            return (
              <a
                aria-current={isActive ? "location" : undefined}
                className={cn(
                  "flex items-baseline gap-2 rounded-md px-2 py-1.5 text-sm transition hover:bg-muted hover:text-foreground",
                  isActive
                    ? "bg-[#58D1E2]/12 text-foreground ring-1 ring-[#58D1E2]/25"
                    : "text-muted-foreground",
                )}
                href={`#${heading.id}`}
                key={heading.id}
                style={{
                  paddingLeft: `${(heading.level - 1) * 0.75 + 0.5}rem`,
                }}
              >
                <span className="min-w-0 flex-1 truncate">{heading.text}</span>
                {showLengths ? (
                  <span
                    aria-label={
                      heading.eighths
                        ? `${formatEighths(heading.eighths)} pages long`
                        : undefined
                    }
                    className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
                  >
                    {heading.eighths ? formatEighths(heading.eighths) : null}
                  </span>
                ) : null}
                {showPages ? (
                  <span
                    aria-label={
                      heading.page ? `page ${heading.page}` : undefined
                    }
                    className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
                  >
                    {heading.page}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Headings from the document will appear here.
        </p>
      )}
    </div>
  );
}
