"use client";

import { useEffect, useRef, useState } from "react";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import { TriangleAlert } from "lucide-react";

import { MarkdownPreview } from "@/components/markdown-reader/markdown-preview";
import { RichMarkdownEditor } from "@/components/markdown-reader/rich-markdown-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function EditableMarkdownPreview({
  activeSentence = null,
  activeSourceLine = null,
  content,
  isEditing,
  onActiveHeadingChange,
  onChange,
}: {
  activeSentence?: string | null;
  activeSourceLine?: number | null;
  content: string;
  isEditing: boolean;
  onActiveHeadingChange: (headingId: string) => void;
  onChange: (content: string) => void;
}) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const [editorError, setEditorError] = useState<null | string>(null);

  useEffect(() => {
    if (!isEditing || !editorRef.current) {
      return;
    }

    if (editorRef.current.getMarkdown() !== content) {
      editorRef.current.setMarkdown(content);
    }
  }, [content, isEditing]);

  if (!isEditing) {
    return (
      <MarkdownPreview
        activeSentence={activeSentence}
        activeSourceLine={activeSourceLine}
        content={content}
        onActiveHeadingChange={onActiveHeadingChange}
      />
    );
  }

  return (
    <div className="space-y-3">
      {editorError ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>This document needs Source view</AlertTitle>
          <AlertDescription>
            The rich editor cannot safely represent part of this Markdown. Your
            document is unchanged; use Source view for unsupported HTML or MDX.
          </AlertDescription>
        </Alert>
      ) : null}

      {!editorError ? (
        <RichMarkdownEditor
          markdown={content}
          onChange={(markdown, initialMarkdownNormalize) => {
            if (!initialMarkdownNormalize) {
              onChange(markdown);
            }
          }}
          onError={({ error }) => {
            // MDXEditor can report an import error while its plugin tree is
            // rendering. Defer our state update to avoid a render-phase React
            // update, then unmount the editor so unsupported constructs cannot
            // be normalized away by a later rich-text edit.
            window.setTimeout(() => setEditorError(error), 0);
          }}
          ref={editorRef}
        />
      ) : null}
    </div>
  );
}
