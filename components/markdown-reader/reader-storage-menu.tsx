"use client";

import { useState } from "react";
import {
  AlertCircle,
  HardDrive,
  LoaderCircle,
  Trash2,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ReaderPersistenceStatus } from "@/hooks/use-reader-session";
import { cn } from "@/lib/utils";

export function ReaderStorageMenu({
  onClearSession,
  status,
}: {
  onClearSession: () => void;
  status: ReaderPersistenceStatus;
}) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  if (status === "unavailable") {
    return null;
  }

  const isBusy = status === "restoring" || status === "saving";
  const isError = status === "error";
  const statusLabel =
    status === "restoring"
      ? "Restoring your session…"
      : status === "saving"
        ? "Saving to this browser…"
        : status === "error"
          ? "Autosave paused"
          : "Saved to this browser";

  const StatusIcon = isBusy ? LoaderCircle : isError ? AlertCircle : HardDrive;
  // The trigger stays still while saving; only a failure needs attention.
  const TriggerIcon = isError ? AlertCircle : HardDrive;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={statusLabel}
              className={cn(
                "mb-0.5 size-9 shrink-0",
                isError ? "text-destructive" : "text-muted-foreground",
              )}
              size="icon"
              type="button"
              variant="ghost"
            />
          }
        >
          <TriggerIcon className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
            <StatusIcon
              className={cn(
                "size-3.5 shrink-0",
                isBusy && "animate-spin",
                isError && "text-destructive",
              )}
              aria-hidden="true"
            />
            {statusLabel}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setIsConfirmOpen(true)}
            variant="destructive"
          >
            <Trash2 aria-hidden="true" />
            Clear saved documents
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog onOpenChange={setIsConfirmOpen} open={isConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear saved documents?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every tab saved in this browser and starts a new,
              empty session. Documents open right now will be closed. This
              can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onClearSession();
                setIsConfirmOpen(false);
              }}
              variant="destructive"
            >
              Clear documents
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
