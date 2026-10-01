"use client";

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  AlertCircle,
  Clapperboard,
  FileInput,
  FileSearch,
  FileText,
  FolderPlus,
  PencilLine,
  Ungroup,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { normalizeDocumentName } from "@/lib/markdown/document";
import type { ReaderTab, ReaderTabGroup } from "@/lib/markdown/types";
import { cn } from "@/lib/utils";

export function ReaderTabTrigger({
  canClose,
  canDrag,
  groups,
  isActive,
  label,
  onClose,
  onDragEnd,
  onDragStart,
  onCreateGroup,
  onKeyDown,
  onMoveToGroup,
  onRename,
  onSelect,
  tab,
}: {
  canClose: boolean;
  canDrag: boolean;
  groups: ReaderTabGroup[];
  isActive: boolean;
  label: string;
  onClose: () => void;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onCreateGroup: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onMoveToGroup: (groupId: null | string) => void;
  onRename: (name: string) => void;
  onSelect: () => void;
  tab: ReaderTab;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draftName, setDraftName] = useState("");
  const [isInvalid, setIsInvalid] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const availableGroups = groups.filter((group) => group.id !== tab.groupId);

  useEffect(() => {
    const input = inputRef.current;

    if (!isRenaming || !input) {
      return;
    }

    input.focus();

    const extensionStart = input.value.search(
      /\.(?:md|markdown|mdown|mkd|pdf)$/i,
    );

    input.setSelectionRange(
      0,
      extensionStart === -1 ? input.value.length : extensionStart,
    );
  }, [isRenaming]);

  function beginRenaming() {
    if (!tab.file) {
      return;
    }

    onSelect();
    setDraftName(tab.file.name);
    setIsInvalid(false);
    setIsRenaming(true);
  }

  function cancelRenaming() {
    setDraftName("");
    setIsInvalid(false);
    setIsRenaming(false);
  }

  function commitRename(cancelIfInvalid = false) {
    const nextName = tab.file
      ? normalizeDocumentName(draftName, tab.file.kind)
      : null;

    if (!nextName) {
      if (cancelIfInvalid) {
        cancelRenaming();
      } else {
        setIsInvalid(true);
        inputRef.current?.focus();
      }

      return;
    }

    if (nextName !== tab.file?.name) {
      onRename(nextName);
    }

    setDraftName("");
    setIsInvalid(false);
    setIsRenaming(false);
  }

  const icon = tab.error ? (
    <AlertCircle
      className="size-3.5 shrink-0 text-destructive"
      aria-hidden="true"
    />
  ) : tab.file?.kind === "screenplay" ? (
    <Clapperboard
      className={cn(
        "size-3.5 shrink-0",
        isActive
          ? "text-[#03444A] dark:text-[#58D1E2]"
          : "text-muted-foreground",
      )}
      aria-hidden="true"
    />
  ) : tab.file?.kind === "pdf" ? (
    <FileSearch
      className={cn(
        "size-3.5 shrink-0",
        isActive
          ? "text-[#03444A] dark:text-[#58D1E2]"
          : "text-muted-foreground",
      )}
      aria-hidden="true"
    />
  ) : (
    <FileText
      className={cn(
        "size-3.5 shrink-0",
        isActive
          ? "text-[#03444A] dark:text-[#58D1E2]"
          : "text-muted-foreground",
      )}
      aria-hidden="true"
    />
  );

  return (
    <>
      {isRenaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 pr-1.5">
          {icon}
          <input
            ref={inputRef}
            aria-invalid={isInvalid}
            aria-label={`Rename ${label}`}
            className="h-5 min-w-0 flex-1 border-0 border-b border-foreground/20 bg-transparent px-0.5 text-xs font-medium text-foreground outline-none transition-[border-color,box-shadow] selection:bg-[#58D1E2]/30 focus-visible:border-[#178b98] focus-visible:shadow-[0_1px_0_0_#178b98] dark:focus-visible:border-[#58D1E2] dark:focus-visible:shadow-[0_1px_0_0_#58D1E2] aria-invalid:border-destructive aria-invalid:shadow-[0_1px_0_0_var(--destructive)]"
            maxLength={180}
            onBlur={() => commitRename(true)}
            onChange={(event) => {
              setDraftName(event.currentTarget.value);
              setIsInvalid(false);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();

              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelRenaming();
              }
            }}
            value={draftName}
          />
          {isInvalid ? (
            <span aria-live="polite" className="sr-only">
              Enter a document name.
            </span>
          ) : null}
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <button
                aria-keyshortcuts={
                  tab.file
                    ? "F2 Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
                    : "Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
                }
                aria-selected={isActive}
                className="flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-t-lg py-2 pl-3 pr-1.5 text-left active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                draggable={canDrag}
                onClick={onSelect}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  beginRenaming();
                }}
                onDragEnd={onDragEnd}
                onDragStart={onDragStart}
                onKeyDown={(event) => {
                  if (event.key === "F2" && tab.file) {
                    event.preventDefault();
                    event.stopPropagation();
                    beginRenaming();
                    return;
                  }

                  onKeyDown(event);
                }}
                role="tab"
                title={
                  tab.file
                    ? `${label} — double-click or press F2 to rename${canDrag ? " · drag to reorder" : ""}`
                    : `${label}${canDrag ? " — drag to reorder" : ""}`
                }
                type="button"
              />
            }
          >
            {icon}
            <span className="truncate">{label}</span>
          </ContextMenuTrigger>

          <ContextMenuContent>
            {tab.file ? (
              <>
                <ContextMenuItem onClick={beginRenaming}>
                  <PencilLine aria-hidden="true" />
                  Rename document
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            ) : null}
            <ContextMenuItem onClick={onCreateGroup}>
              <FolderPlus aria-hidden="true" />
              Add to new group
            </ContextMenuItem>
            {availableGroups.length > 0 ? (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <FileInput aria-hidden="true" />
                  Move to group
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {availableGroups.map((group) => (
                    <ContextMenuItem
                      key={group.id}
                      onClick={() => onMoveToGroup(group.id)}
                    >
                      {group.name}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            ) : null}
            {tab.groupId ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => onMoveToGroup(null)}>
                  <Ungroup aria-hidden="true" />
                  Remove from group
                </ContextMenuItem>
              </>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      )}

      {canClose ? (
        <Button
          aria-label={`Close ${label}`}
          className={cn(
            "mr-1.5 size-5 shrink-0 opacity-70 transition group-hover:opacity-100",
            !isActive && "sm:opacity-0 sm:group-hover:opacity-100",
          )}
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </>
  );
}
