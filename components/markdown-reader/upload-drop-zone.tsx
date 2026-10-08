"use client";

import { ClipboardPaste, Upload } from "lucide-react";
import type { ClipboardEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DropZoneProps = {
  isDragging: boolean;
  onChooseFile: () => void;
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  onPasteMarkdown: () => void;
};

function UploadDropZone({
  isDragging,
  onChooseFile,
  onPaste,
  onPasteMarkdown,
}: DropZoneProps) {
  return (
    <div
      aria-label="Document input area"
      className={cn(
        "relative flex w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed bg-background/70 px-6 py-10 text-center transition focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        isDragging
          ? "border-[#58D1E2] bg-[#58D1E2]/12 text-[#03444A] shadow-[0_0_0_1px_color-mix(in_srgb,var(--core-teal)_35%,transparent)] dark:text-[#58D1E2]"
          : "border-border hover:border-[#58D1E2]/55 hover:bg-muted/35",
      )}
      onPaste={onPaste}
      tabIndex={0}
    >
      <div className="relative z-10 flex max-w-md flex-col items-center">
        <span className="grid size-14 place-items-center rounded-lg border border-[#8EA8AC]/35 bg-[#8EA8AC]/15 text-[#03444A] dark:text-[#58D1E2]">
          <Upload className="size-7" aria-hidden="true" />
        </span>
        <h2 className="mt-5 text-xl font-semibold">Open a document</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Drop a Markdown, Mermaid, Fountain, or PDF document anywhere in this panel,
          choose a file, or paste copied Markdown text.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={onChooseFile} type="button">
            <Upload aria-hidden="true" />
            Choose file
          </Button>
          <Button onClick={onPasteMarkdown} type="button" variant="outline">
            <ClipboardPaste aria-hidden="true" />
            Paste markdown
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Files and pasted text stay in your browser. Nothing is uploaded.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {[".md", ".mmd", ".fountain", ".pdf", "PDFs up to 25 MB", "Local only"].map((label) => (
            <Badge
              className="border-[#8EA8AC]/35 bg-background/70 text-muted-foreground"
              key={label}
              variant="outline"
            >
              {label}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EmptyPreview(props: DropZoneProps) {
  return (
    <>
      <UploadDropZone {...props} />
      <p className="text-center text-xs text-muted-foreground">
        Made by{" "}
        <a
          className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          href="https://www.vizstats.com"
          rel="noopener"
          target="_blank"
        >
          VizStats
        </a>
      </p>
    </>
  );
}
