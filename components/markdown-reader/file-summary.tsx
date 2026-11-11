"use client";

import { Clapperboard, FileText, FileX, PanelLeftClose } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatBytes, formatDate } from "@/lib/markdown/document";
import type { DocumentStats, LoadedFile } from "@/lib/markdown/types";

export function FileSummary({
  file,
  onCollapse,
  onReset,
  stats,
}: {
  file: LoadedFile;
  onCollapse: () => void;
  onReset: () => void;
  stats: DocumentStats;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
          {file.kind === "screenplay" ? (
            <Clapperboard className="size-5" aria-hidden="true" />
          ) : (
            <FileText className="size-5" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={file.name}>
            {file.name}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {formatBytes(file.size)} ·{" "}
            {file.kind === "pdf"
              ? [
                  file.pageCount,
                  file.pageCount === 1 ? "page" : "pages",
                  "· imported",
                ].join(" ")
              : file.source === "paste"
                ? "pasted"
                : "edited"}{" "}
            {formatDate(file.lastModified)}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Collapse sidebar"
                aria-expanded="true"
                onClick={onCollapse}
                size="icon-sm"
                type="button"
                variant="ghost"
              />
            }
          >
            <PanelLeftClose aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Collapse sidebar</TooltipContent>
        </Tooltip>
      </div>

      <Separator />

      <dl className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch text-center">
        {file.kind === "screenplay" ? (
          // A screenplay page runs about a minute of screen time.
          <>
            <Stat label="Pages" value={(stats.pages ?? 0).toLocaleString()} />
            <Separator orientation="vertical" />
            <Stat label="Scenes" value={(stats.scenes ?? 0).toLocaleString()} />
            <Separator orientation="vertical" />
            <Stat label="Runtime" value={formatRuntime(stats.pages ?? 0)} />
          </>
        ) : (
          <>
            <Stat label="Words" value={stats.words.toLocaleString()} />
            <Separator orientation="vertical" />
            <Stat
              label={file.kind === "pdf" ? "Pages" : "Lines"}
              value={(file.kind === "pdf"
                ? file.pageCount
                : stats.lines
              ).toLocaleString()}
            />
            <Separator orientation="vertical" />
            <Stat label="Read" value={`${stats.readingMinutes}m`} />
          </>
        )}
      </dl>

      <Separator />

      <div className="flex justify-end">
        <Button
          className="text-foreground"
          onClick={onReset}
          size="xs"
          type="button"
          variant="destructive"
        >
          <FileX
            aria-hidden="true"
            className="text-destructive"
            data-icon="inline-start"
          />
          Remove document
        </Button>
      </div>
    </div>
  );
}

function formatRuntime(minutes: number) {
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-1.5">
      <dt className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
