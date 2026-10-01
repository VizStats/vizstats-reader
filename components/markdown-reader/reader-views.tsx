"use client";

import { useState, type ClipboardEvent } from "react";
import {
  AlertCircle,
  BookOpen,
  Braces,
  ChevronDown,
  FileSearch,
  FileText,
  PanelLeftOpen,
} from "lucide-react";

import { EditableMarkdownPreview } from "@/components/markdown-reader/editable-markdown-preview";
import { FileSummary } from "@/components/markdown-reader/file-summary";
import { Outline } from "@/components/markdown-reader/outline";
import { PdfOriginalView } from "@/components/markdown-reader/pdf-original-view";
import { ScreenplayPreview } from "@/components/markdown-reader/screenplay-preview";
import {
  EditPreviewButton,
  SourceView,
} from "@/components/markdown-reader/reader-view-controls";
import { EmptyPreview } from "@/components/markdown-reader/upload-drop-zone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ReadAloudController } from "@/hooks/use-read-aloud";
import {
  getSpeakingLine,
  useReaderTabModel,
  type ReaderTabModel,
} from "@/hooks/use-reader-tab-model";
import {
  getReaderTabLabel,
  getReaderViewForValue,
} from "@/lib/markdown/document";
import type { LoadedFile, ReaderTab } from "@/lib/markdown/types";
import { cn } from "@/lib/utils";

type UpdateReaderTab = (tabId: string, updates: Partial<ReaderTab>) => void;

export function SingleReaderView({
  activeModel,
  activeTab,
  className,
  handlePaste,
  isEditing,
  isDragging,
  onChooseFile,
  onOpenPaste,
  onReset,
  onSourceChange,
  reader,
  updateTab,
}: {
  activeModel: ReaderTabModel;
  activeTab: ReaderTab;
  className?: string;
  handlePaste: (event: ClipboardEvent<HTMLElement>) => void;
  isEditing: boolean;
  isDragging: boolean;
  onChooseFile: () => void;
  onOpenPaste: () => void;
  onReset: () => void;
  onSourceChange: (tabId: string, content: string) => void;
  reader: ReadAloudController;
  updateTab: UpdateReaderTab;
}) {
  const file = activeTab.file;
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <div className={cn("min-h-0 flex-1 overflow-hidden", className)}>
      {file ? (
        isSidebarOpen ? (
          <aside className="hidden w-72 shrink-0 flex-col overflow-hidden border-r border-border/70 bg-card/40 lg:flex xl:w-80">
            <div className="flex flex-col gap-3 border-b border-border/70 p-3">
              {activeTab.error ? (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>File not loaded</AlertTitle>
                  <AlertDescription>{activeTab.error}</AlertDescription>
                </Alert>
              ) : null}

              <FileSummary
                file={file}
                onCollapse={() => setIsSidebarOpen(false)}
                onReset={onReset}
                stats={activeModel.stats}
              />
            </div>

            <Outline
              activeHeadingId={activeModel.outlineActiveHeadingId}
              headings={activeModel.headings}
            />
          </aside>
        ) : (
          <aside className="hidden w-11 shrink-0 justify-center border-r border-border/70 bg-card/40 py-3 lg:flex">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Expand sidebar"
                    aria-expanded="false"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setIsSidebarOpen(true)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <PanelLeftOpen aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          </aside>
        )
      ) : null}

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card text-card-foreground">
        <TabsContent
          value="preview"
          className="mt-0 min-h-0 flex-1 overflow-hidden"
        >
          {file?.kind === "screenplay" && isEditing ? (
            <ScreenplayEditor
              activeSourceLine={getSpeakingLine(
                reader,
                activeTab.id,
                activeModel.readAloudChunkLines,
              )}
              content={file.content}
              onActiveHeadingChange={(headingId) =>
                updateTab(activeTab.id, { activeHeadingId: headingId })
              }
              onChange={(content) => onSourceChange(activeTab.id, content)}
              showLivePreview
            />
          ) : (
            <ScrollArea className="h-full">
              <div
                className={cn(
                  file
                    ? "mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 lg:px-10"
                    : "flex min-h-full w-full items-center justify-center p-4 sm:p-6",
                )}
              >
                {file ? (
                  <DocumentPreview
                    activeSourceLine={getSpeakingLine(
                      reader,
                      activeTab.id,
                      activeModel.readAloudChunkLines,
                    )}
                    file={file}
                    isEditing={isEditing}
                    key={`${activeTab.id}:${isEditing ? "editing" : "reading"}`}
                    onActiveHeadingChange={(headingId) =>
                      updateTab(activeTab.id, { activeHeadingId: headingId })
                    }
                    onChange={(content) =>
                      onSourceChange(activeTab.id, content)
                    }
                  />
                ) : (
                  <div className="flex w-full max-w-md flex-col gap-4">
                    {activeTab.error ? (
                      <Alert variant="destructive">
                        <AlertCircle aria-hidden="true" />
                        <AlertTitle>File not loaded</AlertTitle>
                        <AlertDescription>{activeTab.error}</AlertDescription>
                      </Alert>
                    ) : null}
                    <EmptyPreview
                      isDragging={isDragging}
                      onChooseFile={onChooseFile}
                      onPaste={handlePaste}
                      onPasteMarkdown={onOpenPaste}
                    />
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        {file && file.kind !== "pdf" ? (
          <TabsContent
            value="source"
            className="mt-0 min-h-0 flex-1 overflow-hidden"
          >
            <SourceView
              content={file.content}
              label={getSourceLabel(file)}
              onChange={(content) => onSourceChange(activeTab.id, content)}
            />
          </TabsContent>
        ) : null}

        {file?.kind === "pdf" ? (
          <TabsContent
            value="original"
            className="mt-0 min-h-0 flex-1 overflow-hidden"
          >
            <PdfOriginalView
              data={file.originalData}
              key={activeTab.id}
              name={file.name}
              pageCount={file.pageCount}
            />
          </TabsContent>
        ) : null}
      </section>
    </div>
  );
}

export function SplitReaderView({
  activeTabId,
  className,
  editingTabIds,
  onEditingChange,
  onSelectSplitTab,
  onSourceChange,
  primaryTab,
  reader,
  secondaryTab,
  tabs,
  updateTab,
}: {
  activeTabId: string;
  className?: string;
  editingTabIds: ReadonlySet<string>;
  onEditingChange: (tabId: string, isEditing: boolean) => void;
  onSelectSplitTab: (tabId: string) => void;
  onSourceChange: (tabId: string, content: string) => void;
  primaryTab: ReaderTab;
  reader: ReadAloudController;
  secondaryTab: ReaderTab;
  tabs: ReaderTab[];
  updateTab: UpdateReaderTab;
}) {
  return (
    <ResizablePanelGroup
      className={cn("min-h-0 flex-1", className)}
      orientation="horizontal"
    >
      <ResizablePanel defaultSize={50} minSize={35}>
        <SplitReaderPane
          isEditing={editingTabIds.has(primaryTab.id)}
          label="Active tab"
          onEditingChange={(isEditing) =>
            onEditingChange(primaryTab.id, isEditing)
          }
          onSourceChange={onSourceChange}
          reader={reader}
          tab={primaryTab}
          updateTab={updateTab}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={50} minSize={35}>
        <SplitReaderPane
          activeTabId={activeTabId}
          isEditing={editingTabIds.has(secondaryTab.id)}
          label="Second tab"
          onEditingChange={(isEditing) =>
            onEditingChange(secondaryTab.id, isEditing)
          }
          onSelectTab={onSelectSplitTab}
          onSourceChange={onSourceChange}
          reader={reader}
          selectableTabs={tabs}
          tab={secondaryTab}
          updateTab={updateTab}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function SplitReaderPane({
  activeTabId,
  isEditing,
  label,
  onEditingChange,
  onSelectTab,
  onSourceChange,
  reader,
  selectableTabs,
  tab,
  updateTab,
}: {
  activeTabId?: string;
  isEditing: boolean;
  label: string;
  onEditingChange: (isEditing: boolean) => void;
  onSelectTab?: (tabId: string) => void;
  onSourceChange: (tabId: string, content: string) => void;
  reader: ReadAloudController;
  selectableTabs?: ReaderTab[];
  tab: ReaderTab;
  updateTab: UpdateReaderTab;
}) {
  const file = tab.file;
  const model = useReaderTabModel(tab);

  return (
    <Tabs
      className="flex h-full min-h-0 flex-col bg-card text-card-foreground"
      onValueChange={(value) => {
        if (value !== "preview") {
          onEditingChange(false);
        }

        updateTab(tab.id, { view: getReaderViewForValue(value, file) });
      }}
      value={tab.view}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 bg-muted/30 px-2.5 sm:px-3">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3 shadow-xs ring-1 ring-foreground/5">
          <FileText
            className="size-4 shrink-0 text-[#03444A] dark:text-[#58D1E2]"
            aria-hidden="true"
          />
          {selectableTabs && onSelectTab ? (
            <div className="relative flex min-w-0 flex-1 items-center">
              <select
                aria-label="Choose split tab"
                className="w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent pr-5 text-sm font-medium outline-none"
                onChange={(event) => onSelectTab(event.currentTarget.value)}
                value={tab.id}
              >
                {selectableTabs
                  .filter((candidateTab) => candidateTab.id !== activeTabId)
                  .map((candidateTab, index) => (
                    <option
                      className="bg-[Canvas] font-sans text-[CanvasText]"
                      key={candidateTab.id}
                      value={candidateTab.id}
                    >
                      {getReaderTabLabel(candidateTab, index)}
                    </option>
                  ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-0 size-3.5 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {file?.name ?? getReaderTabLabel(tab, 0)}
            </span>
          )}
        </div>

        {file ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <TabsList aria-label={`${label} view`} className="shrink-0">
              <TabsTrigger aria-label="Preview" value="preview">
                <BookOpen aria-hidden="true" />
                <span className="hidden xl:inline">Preview</span>
              </TabsTrigger>
              {file.kind === "pdf" ? (
                <TabsTrigger aria-label="Original PDF" value="original">
                  <FileSearch aria-hidden="true" />
                  <span className="hidden xl:inline">Original</span>
                </TabsTrigger>
              ) : (
                <TabsTrigger aria-label="Source" value="source">
                  <Braces aria-hidden="true" />
                  <span className="hidden xl:inline">Source</span>
                </TabsTrigger>
              )}
            </TabsList>

            {tab.view === "preview" && file.kind !== "pdf" ? (
              <EditPreviewButton
                compact
                isEditing={isEditing}
                onEditingChange={onEditingChange}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {tab.error ? (
        <div className="shrink-0 border-b border-border/70 p-3">
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>File not loaded</AlertTitle>
            <AlertDescription>{tab.error}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <TabsContent
        value="preview"
        className="mt-0 min-h-0 flex-1 overflow-hidden"
      >
        {file?.kind === "screenplay" && isEditing ? (
          <ScreenplayEditor
            activeSourceLine={getSpeakingLine(
              reader,
              tab.id,
              model.readAloudChunkLines,
            )}
            content={file.content}
            onActiveHeadingChange={(headingId) =>
              updateTab(tab.id, { activeHeadingId: headingId })
            }
            onChange={(content) => onSourceChange(tab.id, content)}
            showLivePreview={false}
          />
        ) : (
          <ScrollArea className="h-full">
            <div
              className={cn(
                file
                  ? "mx-auto w-full max-w-3xl px-5 py-8"
                  : "flex min-h-full w-full items-center justify-center p-6",
              )}
            >
              {file ? (
                <DocumentPreview
                  activeSourceLine={getSpeakingLine(
                    reader,
                    tab.id,
                    model.readAloudChunkLines,
                  )}
                  file={file}
                  isEditing={isEditing}
                  key={`${tab.id}:${isEditing ? "editing" : "reading"}`}
                  onActiveHeadingChange={(headingId) =>
                    updateTab(tab.id, { activeHeadingId: headingId })
                  }
                  onChange={(content) => onSourceChange(tab.id, content)}
                />
              ) : (
                <div className="max-w-sm rounded-lg border border-dashed p-6 text-center">
                  <p className="text-sm font-medium">No document in this tab</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Select the tab from the tab strip to open or paste markdown.
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </TabsContent>

      {file && file.kind !== "pdf" ? (
        <TabsContent
          value="source"
          className="mt-0 min-h-0 flex-1 overflow-hidden"
        >
          <SourceView
            content={file.content}
            label={getSourceLabel(file)}
            onChange={(content) => onSourceChange(tab.id, content)}
          />
        </TabsContent>
      ) : null}

      {file?.kind === "pdf" ? (
        <TabsContent
          value="original"
          className="mt-0 min-h-0 flex-1 overflow-hidden"
        >
          <PdfOriginalView
            data={file.originalData}
            key={tab.id}
            name={file.name}
            pageCount={file.pageCount}
          />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

function DocumentPreview({
  activeSourceLine,
  file,
  isEditing,
  onActiveHeadingChange,
  onChange,
}: {
  activeSourceLine: null | number;
  file: LoadedFile;
  isEditing: boolean;
  onActiveHeadingChange: (headingId: string) => void;
  onChange: (content: string) => void;
}) {
  if (file.kind === "screenplay") {
    return (
      <ScreenplayPreview
        activeSourceLine={activeSourceLine}
        content={file.content}
        onActiveHeadingChange={onActiveHeadingChange}
      />
    );
  }

  return (
    <EditableMarkdownPreview
      activeSourceLine={activeSourceLine}
      content={file.content}
      isEditing={file.kind === "markdown" && isEditing}
      onActiveHeadingChange={onActiveHeadingChange}
      onChange={onChange}
    />
  );
}

// Screenplay editing: the Fountain text, with the formatted screenplay
// updating beside it when there is room.
function ScreenplayEditor({
  activeSourceLine,
  content,
  onActiveHeadingChange,
  onChange,
  showLivePreview,
}: {
  activeSourceLine: null | number;
  content: string;
  onActiveHeadingChange: (headingId: string) => void;
  onChange: (content: string) => void;
  showLivePreview: boolean;
}) {
  return (
    <div className="flex h-full min-h-0">
      <div
        className={cn(
          "min-w-0 flex-1",
          showLivePreview && "md:border-r md:border-border/70",
        )}
      >
        <SourceView
          content={content}
          label="Editable Fountain screenplay"
          onChange={onChange}
        />
      </div>
      {showLivePreview ? (
        <ScrollArea className="hidden h-full min-w-0 flex-1 md:block">
          <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
            <ScreenplayPreview
              activeSourceLine={activeSourceLine}
              content={content}
              onActiveHeadingChange={onActiveHeadingChange}
            />
          </div>
        </ScrollArea>
      ) : null}
    </div>
  );
}

function getSourceLabel(file: LoadedFile) {
  return file.kind === "screenplay"
    ? "Editable Fountain screenplay"
    : "Editable markdown source";
}
