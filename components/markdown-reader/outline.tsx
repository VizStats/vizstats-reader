"use client";

import { ListTree } from "lucide-react";

import type { HeadingBlock } from "@/lib/markdown/types";
import { cn } from "@/lib/utils";

export function Outline({
  activeHeadingId,
  headings,
}: {
  activeHeadingId: null | string;
  headings: HeadingBlock[];
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3 text-card-foreground">
      <div className="flex items-center gap-2 px-1 pb-1">
        <ListTree className="size-4 text-[#03444A] dark:text-[#58D1E2]" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Outline
        </h2>
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
                {heading.page ? (
                  <span
                    aria-label={`page ${heading.page}`}
                    className="shrink-0 text-xs tabular-nums text-muted-foreground"
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
