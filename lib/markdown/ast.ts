export type MarkdownAstNode = {
  alt?: string;
  checked?: boolean | null;
  children?: MarkdownAstNode[];
  data?: {
    hProperties?: Record<string, unknown>;
    [key: string]: unknown;
  };
  depth?: number;
  identifier?: string;
  lang?: string | null;
  ordered?: boolean | null;
  position?: { start?: { line?: number } };
  title?: string | null;
  type: string;
  url?: string;
  value?: string;
};

export const MARKDOWN_HEADING_ID_PREFIX = "user-content-";

export function createMarkdownSlugger() {
  const counts = new Map<string, number>();

  return (text: string) => {
    const baseSlug =
      text
        .toLowerCase()
        .replace(/`([^`]+)`/g, "$1")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-") || "section";
    const count = counts.get(baseSlug) ?? 0;

    counts.set(baseSlug, count + 1);

    return count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
  };
}

export function getMarkdownNodeText(node: MarkdownAstNode | undefined): string {
  if (!node) {
    return "";
  }

  switch (node.type) {
    case "text":
    case "inlineCode":
    case "code":
      return node.value ?? "";
    case "break":
    case "thematicBreak":
      return " ";
    case "image":
    case "imageReference":
      return node.alt ?? node.title ?? "";
    case "link":
    case "linkReference":
    case "strong":
    case "emphasis":
    case "delete":
    case "heading":
    case "paragraph":
    case "tableCell":
    case "tableRow":
    case "listItem":
    case "blockquote":
    case "footnoteDefinition":
      return getMarkdownNodesText(node.children);
    case "html":
      return getHtmlPlainText(node.value ?? "");
    default:
      return getMarkdownNodesText(node.children);
  }
}

// Pieces of one line of text: they join as written, so "[a link](…)," reads
// "a link," with no space before the comma. Anything else (paragraphs in a
// quote, cells in a row, raw HTML) is separated by a space.
const INLINE_NODE_TYPES = new Set([
  "break",
  "delete",
  "emphasis",
  "footnoteReference",
  "image",
  "imageReference",
  "inlineCode",
  "link",
  "linkReference",
  "strong",
  "text",
]);

export function getMarkdownNodesText(nodes: MarkdownAstNode[] = []): string {
  let text = "";
  let previousInline = false;

  for (const node of nodes) {
    const inline = INLINE_NODE_TYPES.has(node.type);

    text +=
      (text && !(inline && previousInline) ? " " : "") +
      getMarkdownNodeText(node);
    previousInline = inline;
  }

  return text.replace(/\s+/g, " ").trim();
}

function getHtmlPlainText(html: string) {
  const imageAltText = Array.from(
    html.matchAll(/<img\b[^>]*\balt=(["'])(.*?)\1[^>]*>/gi),
  ).map((match) => match[2]);
  const strippedText = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return decodeBasicHtmlEntities([...imageAltText, strippedText].join(" "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBasicHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
