# Inline Parsing — Design Spec

## Goal

Parse inline markdown syntax within prose blocks (paragraph, heading, setextHeading) to produce an inline node tree. The editor renders this tree as styled spans with visible but dimmed markers. This is CST Phase 2 — `raw` remains the source of truth, and the inline tree is a rendering cache derived from it.

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

The inline parser operates on the content range within a block's `raw` — after block-level markers (e.g., after `## ` for headings). The content range is determined via the block-kind descriptor's `getContentRange` hook, so prose-kind registration is the single source. Returned nodes carry offsets relative to the full `raw`.

### Parsing pipeline

1. **Backtick code spans** — match balanced backtick sequences; content is literal
2. **Backslash escapes** — neutralize the next ASCII-punctuation character so it cannot start markup
3. **Character references** — recognize named, decimal, and hex HTML entities; source remains intact
4. **Links, images, autolinks** — `[text](url)`, `![alt](url)`, `<url>`, and bare URL autolinks in one pass over unoccupied text
5. **Delimiter runs + emphasis** — classify `*`/`_`/`~~` using flanking rules, match via the CommonMark algorithm, recurse for nesting
6. **Post-processing** — hard line breaks (trailing `\` or two spaces before `\n`), then merge adjacent text nodes

Stage order is load-bearing. Code spans claim ranges first so escapes and entities stay inert inside them; escapes and entities run before emphasis so a neutralized `*` or `_` cannot pair as a delimiter.

### Separation from block parser

The block parser does not call the inline parser. Inline parsing is triggered by the editor layer after block-level parsing. Reasons:

- Block parsing is used in contexts that don't render (tree operations, tests) — no need to pay for inline work
- Avoids double parsing during editing (kind detection and rendering are separate concerns)
- Link reference resolution needs document-level context the block parser doesn't have

## Rendering

The renderer takes the inline node array and the block's `raw` string, producing a DOM fragment. The `raw` string is needed to extract marker text via slicing.

Kind-to-DOM mapping:

| Kind            | DOM output                                                                       |
| --------------- | -------------------------------------------------------------------------------- |
| text            | Text node                                                                        |
| inlineCode      | marker spans (dim) + text node for content                                       |
| emphasis        | marker spans (dim) + `<em>` wrapping recursive children                          |
| strong          | marker spans (dim) + `<strong>` wrapping recursive children                      |
| strikethrough   | marker spans (dim) + `<s>` wrapping recursive children                           |
| link            | marker from `raw` slice for `[` and `](url)` + `<a>` wrapping recursive children |
| image           | marker from `raw` slice for `![` and `](url)` + alt text                         |
| autolink        | styled span for URL                                                              |
| hardLineBreak   | marker span for `\` or spaces + text node `\n` (not `<br>`)                      |
| escape          | marker span (dim) for `\` + text node for the escaped character                  |
| entityReference | styled span for the full `&...;` source (named, decimal, or hex)                 |

**Key invariant:** Every character in `raw` has a corresponding text node in the DOM. Markers are visible text in dimmed spans. The contenteditable's textContent equals `ambientPrefix + raw` (minus trailing line ending), where `ambientPrefix` is a read-only string contributed by a parent container to its first prose child (e.g., a list item contributes its `- ` marker). `ambientPrefix === ''` for every block that is not a container's first prose child, recovering the simple textContent-equals-raw equality. Cursor offsets at the block boundary translate between DOM and raw via a single translation pair (`domToRawOffset` / `rawToDomOffset` in `ambient/ambient-offset.ts`).

**Design rules:**

- Marker text is always extracted from `raw` by slicing, never reconstructed from parsed fields. This guarantees textContent matches raw regardless of original syntax spacing.
- Hard line breaks use `\n` text nodes, not `<br>` elements. Text nodes produce consistent textContent across browsers; `<br>` behavior varies.

## Cursor Mapping

Cursor offsets map directly to `raw` positions because markers are visible text in the DOM — `textContent` position equals `raw` offset. Save is trivial (count characters). Restore walks the inline tree's `start`/`end` ranges to find the target DOM text node.

## Per-Input Flow

On every input in a prose block: read textContent → update `raw` → re-parse inline tree → rebuild span tree → restore cursor.

IME composition suppresses the re-render until composition ends. Non-prose blocks are unchanged.
