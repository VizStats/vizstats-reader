"use client";

import { Fragment, useState, type DragEvent, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";

import { ModeToggle } from "@/components/mode-toggle";
import { ReaderStorageMenu } from "@/components/markdown-reader/reader-storage-menu";
import { ReaderTabGroupLabel } from "@/components/markdown-reader/reader-tab-group-label";
import { ReaderTabTrigger } from "@/components/markdown-reader/reader-tab-trigger";
import {
  TAB_GROUP_ACTIVE_BORDER_CLASSES,
  TAB_GROUP_INACTIVE_BORDER_CLASSES,
  TAB_GROUP_TAB_TINT_CLASSES,
} from "@/components/markdown-reader/tab-group-styles";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useActiveTabScroll } from "@/hooks/use-active-tab-scroll";
import type { ReaderPersistenceStatus } from "@/hooks/use-reader-session";
import { getReaderTabLabel } from "@/lib/markdown/document";
import type {
  ReaderTab,
  ReaderTabGroup,
  ReaderTabGroupColor,
} from "@/lib/markdown/types";
import { cn } from "@/lib/utils";

type TabPlacement = "after" | "before";

type TabDropTarget = {
  placement: TabPlacement;
  tabId: string;
};

type GroupDropTarget = {
  groupId: string;
  placement: TabPlacement;
};

const READER_GROUP_DRAG_TYPE = "application/x-markdown-reader-tab-group";
const READER_TAB_DRAG_TYPE = "application/x-markdown-reader-tab";

export function ReaderTabs({
  activeTabId,
  className,
  groups,
  onClearSession,
  onCloseTab,
  onCreateTabGroup,
  onMoveTabToGroup,
  onNewTab,
  onReorderTab,
  onReorderTabGroup,
  onRenameTab,
  onSelectTab,
  onToggleTabGroup,
  onUngroupTabs,
  onUpdateTabGroup,
  persistenceStatus,
  tabs,
}: {
  activeTabId: string;
  className?: string;
  groups: ReaderTabGroup[];
  onClearSession: () => void;
  onCloseTab: (tabId: string) => void;
  onCreateTabGroup: (tabId: string) => void;
  onMoveTabToGroup: (tabId: string, groupId: null | string) => void;
  onNewTab: () => void;
  onReorderTab: (
    movedTabId: string,
    targetTabId: string,
    placement: TabPlacement,
  ) => void;
  onReorderTabGroup: (
    movedGroupId: string,
    targetGroupId: string,
    placement: TabPlacement,
  ) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onSelectTab: (tabId: string) => void;
  onToggleTabGroup: (groupId: string) => void;
  onUngroupTabs: (groupId: string) => void;
  onUpdateTabGroup: (
    groupId: string,
    updates: Partial<Pick<ReaderTabGroup, "collapsed" | "color" | "name">>,
  ) => void;
  persistenceStatus: ReaderPersistenceStatus;
  tabs: ReaderTab[];
}) {
  const { activeTabRef, tabListRef } = useActiveTabScroll(
    activeTabId,
    tabs,
    groups,
  );
  const [announcement, setAnnouncement] = useState("");
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [groupDropTarget, setGroupDropTarget] =
    useState<GroupDropTarget | null>(null);
  const [dropTarget, setDropTarget] = useState<TabDropTarget | null>(null);
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const renderedGroupIds = new Set<string>();
  const orderedGroups = [
    ...new Set(
      tabs.flatMap((tab) => (tab.groupId ? [tab.groupId] : [])),
    ),
  ].flatMap((groupId) => {
    const group = groupsById.get(groupId);

    return group ? [group] : [];
  });

  function resetDragState() {
    setDraggedGroupId(null);
    setDraggedTabId(null);
    setGroupDropTarget(null);
    setDropTarget(null);
  }

  function handleTabDragStart(
    event: DragEvent<HTMLButtonElement>,
    tabId: string,
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(READER_TAB_DRAG_TYPE, tabId);
    setDraggedGroupId(null);
    setDraggedTabId(tabId);
    setGroupDropTarget(null);
    setDropTarget(null);
  }

  function handleGroupDragStart(
    event: DragEvent<HTMLButtonElement>,
    groupId: string,
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(READER_GROUP_DRAG_TYPE, groupId);
    setDraggedGroupId(groupId);
    setDraggedTabId(null);
    setGroupDropTarget(null);
    setDropTarget(null);
  }

  function updateGroupDropTarget(
    event: DragEvent<HTMLElement>,
    targetGroupId: string,
  ) {
    const movedGroupId =
      draggedGroupId ||
      event.dataTransfer.getData(READER_GROUP_DRAG_TYPE);

    if (!movedGroupId || movedGroupId === targetGroupId) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    const targetBounds = event.currentTarget.getBoundingClientRect();
    const placement: TabPlacement =
      event.clientX < targetBounds.left + targetBounds.width / 2
        ? "before"
        : "after";

    setGroupDropTarget((currentTarget) =>
      currentTarget?.groupId === targetGroupId &&
      currentTarget.placement === placement
        ? currentTarget
        : { groupId: targetGroupId, placement },
    );

    return true;
  }

  function moveGroup(
    movedGroupId: string,
    targetGroupId: string,
    placement: TabPlacement,
  ) {
    onReorderTabGroup(movedGroupId, targetGroupId, placement);

    const movedGroup = groupsById.get(movedGroupId);
    const targetGroup = groupsById.get(targetGroupId);

    if (movedGroup && targetGroup) {
      setAnnouncement(
        `${movedGroup.name} moved ${placement} ${targetGroup.name}.`,
      );
    }
  }

  function handleGroupDrop(
    event: DragEvent<HTMLElement>,
    targetGroupId: string,
  ) {
    const movedGroupId =
      draggedGroupId ||
      event.dataTransfer.getData(READER_GROUP_DRAG_TYPE);
    const placement =
      groupDropTarget?.groupId === targetGroupId
        ? groupDropTarget.placement
        : "before";

    event.preventDefault();
    event.stopPropagation();

    if (movedGroupId && movedGroupId !== targetGroupId) {
      moveGroup(movedGroupId, targetGroupId, placement);
    }

    resetDragState();
  }

  function moveGroupByKeyboard(
    groupId: string,
    direction: "left" | "right",
  ) {
    const groupIndex = orderedGroups.findIndex(
      (group) => group.id === groupId,
    );
    const targetGroup =
      orderedGroups[groupIndex + (direction === "left" ? -1 : 1)];

    if (!targetGroup) {
      return;
    }

    moveGroup(
      groupId,
      targetGroup.id,
      direction === "left" ? "before" : "after",
    );
  }

  function handleTabDragOver(
    event: DragEvent<HTMLDivElement>,
    targetTabId: string,
  ) {
    const targetTab = tabs.find((tab) => tab.id === targetTabId);
    const movedGroupId =
      draggedGroupId ||
      event.dataTransfer.getData(READER_GROUP_DRAG_TYPE);

    if (
      movedGroupId &&
      targetTab?.groupId &&
      movedGroupId !== targetTab.groupId
    ) {
      updateGroupDropTarget(event, targetTab.groupId);
      return;
    }

    const movedTabId =
      draggedTabId || event.dataTransfer.getData(READER_TAB_DRAG_TYPE);

    if (!movedTabId || movedTabId === targetTabId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    const targetBounds = event.currentTarget.getBoundingClientRect();
    const placement: TabPlacement =
      event.clientX < targetBounds.left + targetBounds.width / 2
        ? "before"
        : "after";

    setDropTarget((currentTarget) =>
      currentTarget?.tabId === targetTabId &&
      currentTarget.placement === placement
        ? currentTarget
        : { placement, tabId: targetTabId },
    );
  }

  function handleTabDrop(
    event: DragEvent<HTMLDivElement>,
    targetTabId: string,
  ) {
    const targetTab = tabs.find((tab) => tab.id === targetTabId);
    const movedGroupId =
      draggedGroupId ||
      event.dataTransfer.getData(READER_GROUP_DRAG_TYPE);

    if (
      movedGroupId &&
      targetTab?.groupId &&
      movedGroupId !== targetTab.groupId
    ) {
      handleGroupDrop(event, targetTab.groupId);
      return;
    }

    const movedTabId =
      draggedTabId || event.dataTransfer.getData(READER_TAB_DRAG_TYPE);
    const placement =
      dropTarget?.tabId === targetTabId ? dropTarget.placement : "before";

    event.preventDefault();
    event.stopPropagation();

    if (movedTabId && movedTabId !== targetTabId) {
      const movedIndex = tabs.findIndex((tab) => tab.id === movedTabId);
      const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId);

      onReorderTab(movedTabId, targetTabId, placement);

      if (movedIndex !== -1 && targetIndex !== -1) {
        setAnnouncement(
          `${getReaderTabLabel(tabs[movedIndex]!, movedIndex)} moved ${placement} ${getReaderTabLabel(tabs[targetIndex]!, targetIndex)}.`,
        );
      }
    }

    resetDragState();
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    tab: ReaderTab,
    index: number,
  ) {
    if (
      !event.altKey ||
      !event.shiftKey ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
    ) {
      return;
    }

    const moveLeft = event.key === "ArrowLeft";
    const targetIndex = index + (moveLeft ? -1 : 1);
    const targetTab = tabs[targetIndex];

    if (!targetTab) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const placement: TabPlacement = moveLeft ? "before" : "after";

    onReorderTab(tab.id, targetTab.id, placement);
    setAnnouncement(
      `${getReaderTabLabel(tab, index)} moved ${placement} ${getReaderTabLabel(targetTab, targetIndex)}.`,
    );
  }

  return (
    <div className={cn("flex items-end gap-1 px-2.5 pt-2 sm:px-3", className)}>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="mb-1 flex size-7 shrink-0 items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt="VizStats Reader"
          className="size-6 object-contain dark:hidden"
          src="/assets/logo-mark-dark.svg"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          className="hidden size-6 object-contain dark:block"
          src="/assets/logo-mark.svg"
        />
      </div>
      {persistenceStatus === "restoring" ? (
        <div className="flex-1" />
      ) : (
        <div className="flex min-w-0 flex-1 items-end gap-1">
          <div
            ref={tabListRef}
            aria-label="Reader tabs"
            className="flex min-w-0 items-end gap-0.5 overflow-x-auto scrollbar-hide"
            role="tablist"
          >
            {tabs.map((tab, index) => {
              const isActive = tab.id === activeTabId;
              const tabGroup = tab.groupId
                ? groupsById.get(tab.groupId)
                : undefined;
              const shouldRenderGroup =
                tabGroup && !renderedGroupIds.has(tabGroup.id);

              if (tabGroup) {
                renderedGroupIds.add(tabGroup.id);
              }

              const groupTabs = tabGroup
                ? tabs.filter((candidate) => candidate.groupId === tabGroup.id)
                : [];
              const groupHasActiveTab = groupTabs.some(
                (candidate) => candidate.id === activeTabId,
              );
              const label = getReaderTabLabel(tab, index);
              const canClose =
                tabs.length > 1 || Boolean(tab.file) || Boolean(tab.error);
              const isDropTarget = dropTarget?.tabId === tab.id;

              return (
                <Fragment key={tab.id}>
                  {shouldRenderGroup ? (
                    <div
                      ref={
                        tabGroup.collapsed && groupHasActiveTab
                          ? activeTabRef
                          : undefined
                      }
                      className="flex shrink-0 items-end"
                    >
                      <ReaderTabGroupLabel
                        canDrag={orderedGroups.length > 1}
                        dropPlacement={
                          groupDropTarget?.groupId === tabGroup.id
                            ? groupDropTarget.placement
                            : null
                        }
                        group={tabGroup}
                        isDragging={draggedGroupId === tabGroup.id}
                        onColorChange={(color: ReaderTabGroupColor) =>
                          onUpdateTabGroup(tabGroup.id, { color })
                        }
                        onDragEnd={resetDragState}
                        onDragOver={(event) =>
                          void updateGroupDropTarget(event, tabGroup.id)
                        }
                        onDragStart={(event) =>
                          handleGroupDragStart(event, tabGroup.id)
                        }
                        onDrop={(event) =>
                          handleGroupDrop(event, tabGroup.id)
                        }
                        onMoveByKeyboard={(direction) =>
                          moveGroupByKeyboard(tabGroup.id, direction)
                        }
                        onRename={(name) => onUpdateTabGroup(tabGroup.id, { name })}
                        onToggle={() => onToggleTabGroup(tabGroup.id)}
                        onUngroup={() => onUngroupTabs(tabGroup.id)}
                        tabCount={groupTabs.length}
                      />
                    </div>
                  ) : null}

                  {!tabGroup?.collapsed ? (
                    <div
                      ref={isActive ? activeTabRef : undefined}
                      className={cn(
                        "group relative flex min-w-24 max-w-56 -translate-y-0.5 flex-[1_1_14rem] items-center rounded-t-lg border border-b-0 text-xs transition",
                        isActive
                          ? cn(
                              "z-10 text-foreground -mb-px translate-y-0 pb-px shadow-[0_-1px_2px_rgba(0,0,0,0.04)] bg-card",
                              tabGroup
                                ? TAB_GROUP_ACTIVE_BORDER_CLASSES[tabGroup.color]
                                : "border-border/70",
                            )
                          : cn(
                              "text-muted-foreground hover:text-foreground",
                              tabGroup
                                ? cn(
                                    "border-x-0 border-t-0 border-b translate-y-0",
                                    TAB_GROUP_INACTIVE_BORDER_CLASSES[
                                      tabGroup.color
                                    ],
                                    TAB_GROUP_TAB_TINT_CLASSES[tabGroup.color],
                                  )
                                : "bg-card/80 hover:bg-background/60",
                              !tabGroup && "border-none",
                            ),
                        tabGroup && "-ml-0.5",
                        draggedTabId === tab.id && "opacity-45",
                      )}
                      onDragOver={(event) => handleTabDragOver(event, tab.id)}
                      onDrop={(event) => handleTabDrop(event, tab.id)}
                    >
                      {isDropTarget ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "pointer-events-none absolute inset-y-1 z-20 w-0.5 rounded-full bg-[#03444A] shadow-[0_0_0_1px_var(--background)] dark:bg-[#58D1E2]",
                            dropTarget.placement === "before"
                              ? "-left-1"
                              : "-right-1",
                          )}
                        />
                      ) : null}
                      <ReaderTabTrigger
                        canClose={canClose}
                        canDrag={tabs.length > 1}
                        groups={groups}
                        isActive={isActive}
                        label={label}
                        onClose={() => onCloseTab(tab.id)}
                        onCreateGroup={() => onCreateTabGroup(tab.id)}
                        onDragEnd={resetDragState}
                        onDragStart={(event) => handleTabDragStart(event, tab.id)}
                        onKeyDown={(event) => handleTabKeyDown(event, tab, index)}
                        onMoveToGroup={(groupId) =>
                          onMoveTabToGroup(tab.id, groupId)
                        }
                        onRename={(name) => {
                          onRenameTab(tab.id, name);
                          setAnnouncement(`${label} renamed to ${name}.`);
                        }}
                        onSelect={() => onSelectTab(tab.id)}
                        tab={tab}
                      />
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
          </div>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="New reader tab"
                  className="mb-1 size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
                  onClick={onNewTab}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <Plus aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>New tab</TooltipContent>
          </Tooltip>
        </div>
      )}

      <ReaderStorageMenu
        onClearSession={onClearSession}
        status={persistenceStatus}
      />

      <div className="mb-0.5 shrink-0">
        <ModeToggle />
      </div>
    </div>
  );
}
