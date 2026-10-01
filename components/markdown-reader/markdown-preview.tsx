"use client";

import { useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import {
  markdownComponents,
  markdownSanitizeSchema,
  markdownUrlTransform,
} from "@/components/markdown-reader/markdown-preview-renderers";
import { usePreviewTracking } from "@/hooks/use-preview-tracking";
import { remarkHeadingIds } from "@/lib/markdown/remark-heading-ids";

export function MarkdownPreview({
  activeSourceLine = null,
  content,
  onActiveHeadingChange,
}: {
  activeSourceLine?: number | null;
  content: string;
  onActiveHeadingChange: (headingId: string) => void;
}) {
  const articleRef = useRef<HTMLElement>(null);

  usePreviewTracking(articleRef, {
    activeSourceLine,
    content,
    onActiveHeadingChange,
  });

  if (!content.trim()) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        This markdown file is empty.
      </div>
    );
  }

  return (
    <article
      className="markdown-preview"
      data-readable-root="preview"
      ref={articleRef}
    >
      <ReactMarkdown
        components={markdownComponents}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
        remarkPlugins={[remarkGfm, remarkHeadingIds]}
        urlTransform={markdownUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
