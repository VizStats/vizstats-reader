# VizStats Reader Main Watchouts

These are the main implementation watchouts to keep visible as the reader grows.

## Markdown Fidelity

Baseline implemented: read-only preview renders through `react-markdown` with `remark-gfm`, `rehype-raw`, and `rehype-sanitize`; rich editing uses client-only MDXEditor with Markdown-native AST conversion; outline/read-aloud metadata comes from a `unified` + `remark-gfm` AST pass. Unsupported HTML/MDX stays editable through Source view rather than being rendered unsafely in the rich editor. Keep testing against real-world markdown, especially around local image paths, math, syntax highlighting, and very large documents.

## Remote Markdown Resources

External HTTP(S) images are allowed because the local-only guarantee applies to the Markdown file and document content: the app does not upload or store either on a server. Loading an external image does contact the host referenced by that image directly from the browser, so keep the URL-scheme allowlist in place and never proxy document content through the app server.

## Mermaid Diagrams

`mermaid` code blocks render through `components/markdown-reader/mermaid-diagram.tsx`, which imports Mermaid on demand and renders at `securityLevel: "strict"`. Mermaid sanitizes label HTML with its own DOMPurify pass, not `lib/markdown/sanitize.ts`, so an `<img>` in a label survives with its handlers stripped and is fetched by the browser like any other document image. Keep `strict`; `loose` would let diagrams attach click handlers and raw HTML. The diagram palette in `lib/markdown/mermaid.ts` mirrors the CSS tokens by hand because Mermaid needs concrete colors: change both together.

## Reader Tab State Complexity

The main reader shell still owns tab mutations directly. If the app adds persistence, tab renaming, recents, saved sessions, split panes, or synced selections, move tab state into a dedicated reducer or hook before the component becomes hard to reason about.

## Read Aloud Lifecycle

Playback must stop whenever its source document is edited, removed, closed, or cleared from the saved session. Keep both desktop and mobile controls wired to the same lifted reader controller.
