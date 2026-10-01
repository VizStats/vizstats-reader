"use client";

import { Fragment, useMemo, useRef, type ReactNode } from "react";

import { usePreviewTracking } from "@/hooks/use-preview-tracking";
import {
  parseFountainInline,
  type FountainInline,
} from "@/lib/fountain/inline";
import { getScreenplayHeadingIds } from "@/lib/fountain/model";
import {
  parseFountain,
  type DialogueBlock,
  type Screenplay,
  type TitlePageEntry,
} from "@/lib/fountain/parse";

// Title page keys printed centered as the headline; the rest sit below it.
const HEADLINE_KEYS = new Set([
  "title",
  "credit",
  "author",
  "authors",
  "source",
]);

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
  const screenplay = useMemo(() => parseFountain(content), [content]);

  usePreviewTracking(articleRef, {
    activeSourceLine,
    content,
    onActiveHeadingChange,
  });

  if (screenplay.elements.length === 0 && screenplay.titlePage.length === 0) {
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
      <ScreenplayBody screenplay={screenplay} />
    </article>
  );
}

function TitlePage({ entries }: { entries: TitlePageEntry[] }) {
  const headline = entries.filter((entry) =>
    HEADLINE_KEYS.has(entry.key.toLowerCase()),
  );
  const details = entries.filter(
    (entry) => !HEADLINE_KEYS.has(entry.key.toLowerCase()),
  );

  return (
    <header
      className="screenplay-title-page"
      data-source-line={entries[0]!.line}
    >
      <div className="screenplay-title-headline">
        {headline.map((entry) => (
          <div
            data-title-key={entry.key.toLowerCase()}
            key={`${entry.line}-${entry.key}`}
          >
            <Lines values={entry.values} />
          </div>
        ))}
      </div>
      {details.length > 0 ? (
        <dl className="screenplay-title-details">
          {details.map((entry) => (
            <div key={`${entry.line}-${entry.key}`}>
              <dt>{entry.key}</dt>
              <dd>
                <Lines values={entry.values} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}

function ScreenplayBody({ screenplay }: { screenplay: Screenplay }) {
  const ids = getScreenplayHeadingIds(screenplay);

  return screenplay.elements.map((element) => {
    const key = `${element.line}-${element.type}`;

    switch (element.type) {
      case "section":
        return (
          <p
            className="screenplay-section"
            data-level={element.level}
            data-markdown-heading
            data-source-line={element.line}
            id={ids.get(element)}
            key={key}
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
            key={key}
          >
            {element.sceneNumber ? (
              <span className="screenplay-scene-number">
                {element.sceneNumber}
              </span>
            ) : null}
            <Inline text={element.text} />
          </h3>
        );
      case "action":
        return (
          <p
            className="screenplay-action"
            data-source-line={element.line}
            key={key}
          >
            <Inline text={element.text} />
          </p>
        );
      case "centered":
        return (
          <p
            className="screenplay-centered"
            data-source-line={element.line}
            key={key}
          >
            <Inline text={element.text} />
          </p>
        );
      case "lyrics":
        return (
          <p
            className="screenplay-lyrics"
            data-source-line={element.line}
            key={key}
          >
            <Inline text={element.text} />
          </p>
        );
      case "synopsis":
        return (
          <p
            className="screenplay-synopsis"
            data-source-line={element.line}
            key={key}
          >
            <Inline text={element.text} />
          </p>
        );
      case "transition":
        return (
          <p
            className="screenplay-transition"
            data-source-line={element.line}
            key={key}
          >
            <Inline text={element.text} />
          </p>
        );
      case "dialogue":
        return <Dialogue block={element} key={key} />;
      case "dual-dialogue":
        return (
          <div className="screenplay-dual-dialogue" key={key}>
            <Dialogue block={element.left} />
            <Dialogue block={element.right} />
          </div>
        );
      case "page-break":
        return (
          <hr
            aria-label="Page break"
            className="screenplay-page-break"
            data-source-line={element.line}
            key={key}
          />
        );
    }
  });
}

function Dialogue({ block }: { block: DialogueBlock }) {
  return (
    <div className="screenplay-dialogue">
      <p className="screenplay-character">
        <Inline text={block.character} />
        {block.extension ? <> {block.extension}</> : null}
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
