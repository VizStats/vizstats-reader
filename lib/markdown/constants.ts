export const ACCEPTED_FILE_TYPES =
  ".md,.markdown,.mdown,.mkd,.mmd,.mermaid,.fountain,.spmd,.pdf,text/markdown,text/plain,application/pdf";
export const MAX_MARKDOWN_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_PDF_FILE_SIZE = 25 * 1024 * 1024;
// Cap how many files one open/drop action turns into tabs, to avoid flooding
// the tab strip when a large selection or folder is dropped.
export const MAX_OPEN_FILES = 20;
