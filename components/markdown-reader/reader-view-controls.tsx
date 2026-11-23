"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ClipboardPaste,
  Copy,
  Download,
  EllipsisVertical,
  PencilLine,
  Printer,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { rememberReadableSelection } from "@/lib/markdown/speech";
import type { LoadedFile } from "@/lib/markdown/types";

export function EditPreviewButton({
  compact = false,
  isEditing,
  onEditingChange,
}: {
  compact?: boolean;
  isEditing: boolean;
  onEditingChange: (isEditing: boolean) => void;
}) {
  const label = isEditing ? "Done editing preview" : "Edit preview";

  return (
    <Button
      aria-label={label}
      aria-pressed={isEditing}
      className="shrink-0"
      onClick={() => onEditingChange(!isEditing)}
      size={compact ? "icon-sm" : "icon"}
      title={label}
      type="button"
      variant={isEditing ? "default" : "secondary"}
    >
      {isEditing ? (
        <Check aria-hidden="true" />
      ) : (
        <PencilLine aria-hidden="true" />
      )}
    </Button>
  );
}

export function CopySourceButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<null | number>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const label = copied ? "Copied" : "Copy source";

  return (
    <Button
      aria-label={label}
      className="shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(content);
        } catch {
          toast.error("Could not copy to the clipboard.");
          return;
        }

        setCopied(true);

        if (resetTimerRef.current !== null) {
          window.clearTimeout(resetTimerRef.current);
        }

        resetTimerRef.current = window.setTimeout(() => {
          setCopied(false);
          resetTimerRef.current = null;
        }, 2000);
      }}
      size="icon"
      title={label}
      type="button"
      variant="secondary"
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  );
}

// Document actions used now and then, kept behind one button so the toolbar
// shows only what is used all the time.
export function DocumentActionsMenu({
  kind,
  onDownload,
  onOpenFile,
  onPaste,
}: {
  kind: LoadedFile["kind"];
  onDownload: () => void;
  onOpenFile: () => void;
  onPaste: () => void;
}) {
  const downloadLabel =
    kind === "pdf"
      ? "Export text as .md"
      : kind === "screenplay"
        ? "Download .fountain"
        : "Download .md";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="More document actions"
            className="shrink-0"
            size="icon"
            title="More"
            type="button"
            variant="secondary"
          />
        }
      >
        <EllipsisVertical aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        <DropdownMenuItem onClick={onOpenFile}>
          <Upload aria-hidden="true" />
          Open file…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onPaste}>
          <ClipboardPaste aria-hidden="true" />
          Paste Markdown…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDownload}>
          <Download aria-hidden="true" />
          {downloadLabel}
        </DropdownMenuItem>
        {kind === "screenplay" ? (
          <DropdownMenuItem onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            Print or save as PDF…
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SourceView({
  content,
  label = "Editable markdown source",
  onChange,
}: {
  content: string;
  label?: string;
  onChange: (content: string) => void;
}) {
  return (
    <div className="h-full bg-muted/30">
      <textarea
        aria-label={label}
        className="h-full min-h-full w-full resize-none overflow-auto bg-transparent p-5 font-mono text-xs leading-relaxed text-foreground caret-[#03444A] outline-none selection:bg-[#58D1E2]/30 placeholder:text-muted-foreground dark:caret-[#58D1E2] sm:p-8"
        data-readable-root="source"
        onChange={(event) => onChange(event.currentTarget.value)}
        onSelect={(event) => {
          const textarea = event.currentTarget;

          rememberReadableSelection(
            textarea.value.slice(
              textarea.selectionStart,
              textarea.selectionEnd,
            ),
          );
        }}
        spellCheck={false}
        value={content}
      />
    </div>
  );
}
