# Inline Parsing — Design Spec

## Goal

Parse inline markdown syntax within inline-bearing blocks — kinds registering `supportsInline` on the block-kind descriptor (paragraph, heading, setextHeading, tableCell) — to produce an inline node tree. The editor renders this tree as styled spans with visible but dimmed markers; table cells run the same parse + styled-render pipeline, just with no ambient prefix or block marker. This is CST Phase 2 — `raw` remains the source of truth, and the inline tree is a rendering cache derived from it.

## Key Design Decisions

### raw as source of truth (CST Phase 2 model)

`inlineContent` is derived from `raw`, re-parsed on every edit, never used for serialization. `serialize()` still reads `raw` only. If the inline parser has bugs, worst case is wrong styling, never data loss. The inline tree is disposable — a rendering cache.

### Re-render on every input

Every input event triggers: read `textContent` → update `raw` → re-parse inline → rebuild span tree → restore cursor. The span structure is always correct because it's rebuilt after every character.

### CommonMark delimiter-run algorithm

Emphasis, strong, and strikethrough use the CommonMark two-phase approach: scan for delimiter runs and classify as opener/closer using left/right flanking rules, then match openers to closers using spec precedence. Backtick spans, links, images, and autolinks each have their own matching logic.

## InlineNode Model

Same flat-interface philosophy as CstNode — discriminate on `kind`, no class hierarchy. See `docs/design/editor/syntax-tree.md` for the full type table.

Each node carries `start`/`end` byte offsets into the parent block's `raw`, covering the full range including markers. Every character in `raw` belongs to exactly one inline node's range. Nodes with children (emphasis, strong, strikethrough, link) nest recursively.

## Inline Parser Architecture

### Scope

The inline parser operates on the content range within a block's `raw` — after block-level markers (e.g., after `## ` for headings). The content range is determined via the block-kind descriptor's `getContentRange` hook, so prose-kind registration is the single source. Returned nodes carry offsets relative to that block's own `raw`.

### Coordinate spaces

Inline offsets live in **one** space: the prose block's own `raw`. For a prose block inside a strip container (blockquote, list), that `raw` is a slice of the container's **stripped inner buffer** — the parser strips the `> `/marker/indent prefix before parsing children, so a child's `raw` never contains the container syntax. This is a distinct space from the **container's** `raw`, which keeps the prefix.

The two spaces are bridged **structurally**, not by any runtime offset-rebasing function:

- **In** (parse): the container parser strips its prefix once, then parses children from the stripped buffer.
- **Out** (serialize): `serialize(children)` / the descriptor's `rebuildRaw` re-applies the prefix. This is the strip-container secondary invariant (`strip(raw) === serialize(children)`; see syntax-tree.md).

There is no function that maps an inline offset into the container's `raw`, because nothing needs one — inline parsing, cursor offsets, and selection all work in the prose block's own `raw`. The only _runtime_ coordinate translation is DOM ↔ raw, handled by the ambient-prefix contract (`textContent === ambientPrefix + raw`) through `cursor/widget-offset.ts` — see the Rendering section's Key invariant.

### Parsing pipeline

1. **Backtick code spans** — match balanced backtick sequences; content is literal
2. **Backslash escapes** — neutralize the next ASCII-punctuation character so it cannot start markup
3. **Character references** — recognize named, decimal, and hex HTML entities; source remains intact
4. **Links, images, autolinks** — `[text](url)`, `![alt](url)`, `<url>`, and bare URL autolinks in one pass over unoccupied text
5. **Raw HTML** — claim inline HTML tags as literal ranges; runs after links so autolinks win for `<url>`/`<email>`, and before emphasis so `*`/`_` inside tag attributes cannot pair as delimiters
6. **Delimiter runs + emphasis** — classify `*`/`_`/`~~` using flanking rules, match via the CommonMark algorithm, recurse for nesting
7. **Post-processing** — hard line breaks (trailing `\` or two spaces before `\n`), then merge adjacent text nodes

Stage order is load-bearing. Code spans claim ranges first so escapes and entities stay inert inside them; escapes and entities run before emphasis so a neutralized `*` or `_` cannot pair as a delimiter.

### Separation from block parser

The block parser does not call the inline parser. Inline parsing is triggered by the editor layer after block-level parsing. Reasons:

- Block parsing is used in contexts that don't render (tree operations, tests) — no need to pay for inline work
- Avoids double parsing during editing (kind detection and rendering are separate concerns)
- Link reference resolution needs document-level context the block parser doesn't have

## Rendering

The renderer takes the inline node array and the block's `raw` string, producing a DOM fragment. The `raw` string is needed to extract marker text via slicing.

Kind-to-DOM mapping:

| Kind                | DOM output                                                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| text                | Text node                                                                                                                                                                                                   |
| inlineCode          | marker spans (dim) + text node for content                                                                                                                                                                  |
| emphasis            | marker spans (dim) + `<em>` wrapping recursive children                                                                                                                                                     |
| strong              | marker spans (dim) + `<strong>` wrapping recursive children                                                                                                                                                 |
| strikethrough       | marker spans (dim) + `<s>` wrapping recursive children                                                                                                                                                      |
| link                | marker from `raw` slice for `[` and `](url)` + `<a>` wrapping recursive children — for an allowlisted scheme; a blocked scheme renders an inert `span` instead (markers and text preserved, no live `href`) |
| image               | atomic `<img>` widget (`contenteditable="false"`) — see the Key invariant below — unless the kind opts out via the descriptor's `renderImagesAsWidgets` (table cells fall back to alt text)                 |
| autolink            | styled span for URL                                                                                                                                                                                         |
| hardLineBreak       | marker span for `\` or spaces + text node `\n` (not `<br>`)                                                                                                                                                 |
| escape              | marker span (dim) for `\` + text node for the escaped character                                                                                                                                             |
| entityReference     | styled span for the full `&...;` source (named, decimal, or hex)                                                                                                                                            |
| unresolvedReference | styled span for the literal source of a reference whose label has no matching definition                                                                                                                    |
| rawHtml             | allowlisted tags (`<br>`) render as atomic widgets; other raw HTML as a styled source span                                                                                                                  |

**Key invariant:** Every character in `raw` has a corresponding text node in the DOM, **except for atomic widgets** (images, and live raw HTML such as `<br>`; future: math, footnote refs). Atomic widgets render as `[data-inline-widget]` `contenteditable="false"` elements with no textContent — `[data-inline-widget]` is the generic marker the cursor machinery keys off, regardless of widget kind. Their raw bytes are stored on `data-source-start` / `data-source-end` attributes and reconstructed during input via `node.raw.slice(start, end)`. Markers are visible text in dimmed spans. For widget-free prose, the contenteditable's textContent equals `ambientPrefix + raw` (minus trailing line ending), where `ambientPrefix` is a read-only string contributed by a parent container to its first prose child (e.g., a list item contributes its `- ` marker). `cursor/widget-offset.ts` walks the DOM raw-aware (text-node lengths plus widget raw lengths) to translate between DOM Range positions and raw offsets in either direction.

**Design rules:**

- Marker text is always extracted from `raw` by slicing, never reconstructed from parsed fields. This guarantees textContent matches raw regardless of original syntax spacing.
- Hard line breaks use `\n` text nodes, not `<br>` elements. Text nodes produce consistent textContent across browsers; `<br>` behavior varies.

## Cursor Mapping

Cursor offsets map directly to `raw` positions because markers are visible text in the DOM — `textContent` position equals `raw` offset. Save is trivial (count characters). Restore walks the inline tree's `start`/`end` ranges to find the target DOM text node.

## Per-Input Flow

On every input in an inline-bearing block: read textContent → update `raw` → re-parse inline tree → rebuild span tree → restore cursor.

IME composition suppresses the re-render until composition ends. Blocks without inline support are unchanged.
