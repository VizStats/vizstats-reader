"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal, flushSync } from "react-dom";

import { usePreviewTracking } from "@/hooks/use-preview-tracking";
import {
  parseFountainInline,
  type FountainInline,
} from "@/lib/fountain/inline";
import { getScreenplayHeadingIds } from "@/lib/fountain/model";
import {
  paginateScreenplay,
  type PageItem,
  type ScreenplayPage,
} from "@/lib/fountain/paginate";
import {
  parseFountain,
  type DialogueBlock,
  type ScreenplayElement,
  type TitlePageEntry,
} from "@/lib/fountain/parse";

// Title page keys printed centered as the headline. The rest sit at the foot
// of the page: contact details on the left, dates and revisions on the right.
const HEADLINE_KEYS = new Set([
  "title",
  "credit",
  "author",
  "authors",
  "source",
]);
const RIGHT_FOOT_KEYS = new Set(["draft date", "date", "revision"]);
const NO_IDS = new Map<ScreenplayElement, string>();
const PRINT_PAGE_RULE = "@page { margin: 0; size: letter; }";

function useScreenplayLayout(content: string) {
  return useMemo(() => {
    const screenplay = parseFountain(content);

    return {
      ids: getScreenplayHeadingIds(screenplay),
      pages: paginateScreenplay(screenplay).pages,
      screenplay,
    };
  }, [content]);
}

export function ScreenplayPreview({
  activeSourceLine = null,
  content,
  onActiveHeadingChange,
}: {
  activeSourceLine?: number | null;
  content: string;
  onActiveHeadingChange: (headingId: string) => void;
}) {
  const articleRef = useRef<HTMLElement>(null);
  const { ids, pages, screenplay } = useScreenplayLayout(content);

  usePreviewTracking(articleRef, {
    activeSourceLine,
    content,
    onActiveHeadingChange,
  });

  if (pages.length === 0 && screenplay.titlePage.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        This screenplay is empty.
      </div>
    );
  }

  return (
    <article
      className="screenplay-preview"
      data-readable-root="preview"
      ref={articleRef}
    >
      {screenplay.titlePage.length > 0 ? (
        <TitlePage entries={screenplay.titlePage} />
      ) : null}
      {pages.map((page) => (
        <Page ids={ids} key={page.number} page={page} />
      ))}
    </article>
  );
}

// The printed script, mounted only while the browser prints and placed
// straight under <body>, so the print stylesheet can set it on Letter sheets
// and hide the app around it. Covers Cmd/Ctrl+P as well as the print button.
export function ScreenplayPrint({
  content,
  name,
}: {
  content: string;
  name: string;
}) {
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    let appTitle: null | string = null;

    const handleBeforePrint = () => {
      appTitle ??= document.title;
      // Browsers name a saved PDF after the page title.
      document.title = name.replace(/\.(fountain|spmd)$/i, "");
      flushSync(() => setIsPrinting(true));
    };
    const handleAfterPrint = () => {
      setIsPrinting(false);

      if (appTitle !== null) {
        document.title = appTitle;
        appTitle = null;
      }
    };

    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);

    return () => {
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", handleAfterPrint);
      handleAfterPrint();
    };
  }, [name]);

  return isPrinting
    ? createPortal(<PrintedScreenplay content={content} />, document.body)
    : null;
}

// Sections, synopses and notes are the writer's own and stay off paper.
function PrintedScreenplay({ content }: { content: string }) {
  const { pages, screenplay } = useScreenplayLayout(content);

  return (
    <div className="screenplay-print">
      {/* Margins live on each page, so the sheet itself has none. Scoped to
          this element, it leaves printing other documents untouched. */}
      <style>{PRINT_PAGE_RULE}</style>
      {screenplay.titlePage.length > 0 ? (
        <TitlePage entries={screenplay.titlePage} />
      ) : null}
      {pages.map((page) => (
        <Page ids={NO_IDS} key={page.number} page={page} print />
      ))}
    </div>
  );
}

function TitlePage({ entries }: { entries: TitlePageEntry[] }) {
  const headline = entries.filter((entry) =>
    HEADLINE_KEYS.has(entry.key.toLowerCase()),
  );
  const foot = entries.filter(
    (entry) => !HEADLINE_KEYS.has(entry.key.toLowerCase()),
  );

  return (
    <section
      aria-label="Title page"
      className="screenplay-page screenplay-cover"
      data-source-line={entries[0]!.line}
    >
      <div className="screenplay-cover-headline">
        {headline.map((entry) => (
          <div
            data-title-key={entry.key.toLowerCase()}
            key={`${entry.line}-${entry.key}`}
          >
            <Lines values={entry.values} />
          </div>
        ))}
      </div>
      {foot.length > 0 ? (
        <div className="screenplay-cover-foot">
          <TitlePageEntries
            entries={foot.filter(
              (entry) => !RIGHT_FOOT_KEYS.has(entry.key.toLowerCase()),
            )}
          />
          <TitlePageEntries
            entries={foot.filter((entry) =>
              RIGHT_FOOT_KEYS.has(entry.key.toLowerCase()),
            )}
            side="right"
          />
        </div>
      ) : null}
    </section>
  );
}

// Printed title pages carry values, not labels; the labels stay for screen
// readers.
function TitlePageEntries({
  entries,
  side = "left",
}: {
  entries: TitlePageEntry[];
  side?: "left" | "right";
}) {
  return (
    <dl data-side={side}>
      {entries.map((entry) => (
        <div key={`${entry.line}-${entry.key}`}>
          <dt className="sr-only">{entry.key}</dt>
          <dd>
            <Lines values={entry.values} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

// One printed page. Page one carries no number, as on a printed script.
function Page({
  ids,
  page,
  print = false,
}: {
  ids: Map<ScreenplayElement, string>;
  page: ScreenplayPage;
  print?: boolean;
}) {
  const items = print
    ? page.items.filter(
        ({ element }) =>
          element.type !== "section" && element.type !== "synopsis",
      )
    : page.items;

  return (
    <section
      aria-label={`Page ${page.number}`}
      className="screenplay-page"
      data-page={page.number}
    >
      {page.number > 1 ? (
        <span aria-hidden="true" className="screenplay-page-number">
          {page.number}.
        </span>
      ) : null}
      <div className="screenplay-page-body">
        {items.map((item, index) => (
          <PageElement ids={ids} item={item} key={index} />
        ))}
      </div>
    </section>
  );
}

function PageElement({
  ids,
  item,
}: {
  ids: Map<ScreenplayElement, string>;
  item: PageItem;
}) {
  const { element } = item;

  switch (element.type) {
    case "section":
      return (
        <p
          className="screenplay-section"
          data-level={element.level}
          data-markdown-heading
          data-source-line={element.line}
          id={ids.get(element)}
        >
          <Inline text={element.text} />
        </p>
      );
    case "scene-heading":
      return (
        <h3
          className="screenplay-scene-heading"
          data-markdown-heading
          data-source-line={element.line}
          id={ids.get(element)}
        >
          {element.sceneNumber ? (
            <>
              <span className="screenplay-scene-number" data-side="left">
                {element.sceneNumber}
              </span>
              <span className="screenplay-scene-number" data-side="right">
                {element.sceneNumber}
              </span>
            </>
          ) : null}
          <Inline text={element.text} />
        </h3>
      );
    case "action":
    case "centered":
    case "lyrics":
    case "synopsis":
    case "transition":
      return (
        <p
          className={`screenplay-${element.type}`}
          data-source-line={element.line}
        >
          <Inline text={element.text} />
        </p>
      );
    case "dialogue":
      return (
        <Dialogue block={element} continued={item.continued} more={item.more} />
      );
    case "dual-dialogue":
      return (
        <div className="screenplay-dual-dialogue">
          <Dialogue block={element.left} />
          <Dialogue block={element.right} />
        </div>
      );
    case "page-break":
      return null;
  }
}

// A speech carried over from the previous page repeats its cue with
// (CONT'D); one that carries on overleaf ends with (MORE).
function Dialogue({
  block,
  continued = false,
  more = false,
}: {
  block: DialogueBlock;
  continued?: boolean;
  more?: boolean;
}) {
  const extension =
    continued && !/cont/i.test(block.extension)
      ? `${block.extension} (CONT'D)`.trim()
      : block.extension;

  return (
    <div className="screenplay-dialogue">
      <p className="screenplay-character">
        <Inline text={block.character} />
        {extension ? <> {extension}</> : null}
      </p>
      {block.runs.map((run) => (
        <p
          className={`screenplay-line-${run.type}`}
          data-source-line={run.line}
          key={run.line}
        >
          <Inline text={run.text} />
        </p>
      ))}
      {more ? <p className="screenplay-more">(MORE)</p> : null}
    </div>
  );
}

function Lines({ values }: { values: string[] }) {
  return values.map((value, index) => (
    <Fragment key={index}>
      {index > 0 ? <br /> : null}
      <Inline text={value} />
    </Fragment>
  ));
}

function Inline({ text }: { text: string }) {
  return renderInline(parseFountainInline(text));
}

function renderInline(nodes: FountainInline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <Fragment key={index}>{node.value}</Fragment>;
      case "note":
        return (
          <span className="screenplay-note" key={index} title="Note">
            {node.value}
          </span>
        );
      case "bold":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "italic":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "bold-italic":
        return (
          <strong key={index}>
            <em>{renderInline(node.children)}</em>
          </strong>
        );
      case "underline":
        return <u key={index}>{renderInline(node.children)}</u>;
    }
  });
}
