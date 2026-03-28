# Inline Parsing — Design Spec

**Status:** Designed, not yet implemented.
**Depends on:** Block-level CST (Phase 1, complete), Editor Phase 2 (complete).
**Date:** 2026-03-28

## Goal

Parse inline markdown syntax within prose blocks (paragraph, heading, setextHeading) to produce an inline node tree. The editor renders this tree as styled spans with visible but dimmed markers. This is CST Phase 2 — `raw` remains the source of truth, and the inline tree is a rendering cache derived from it.

## Key Design Decisions

### raw as source of truth (CST Phase 2 model)

`inlineContent` is derived from `raw`, re-parsed on every edit, never used for serialization. `serialize()` still reads `raw` only. If the inline parser has bugs, worst case is wrong styling, never data loss. The inline tree is disposable — a rendering cache.

### Rendering approach: re-render on every input (Approach A)

Every input event triggers: read `textContent` → update `raw` → re-parse inline → rebuild span tree → restore cursor. The span structure is always correct because it's rebuilt after every character.

**Fallback (Approach C):** If Approach A proves unworkable (persistent cursor bugs, contenteditable fighting spans, IME breakage), fall back to a decorations layer — keep contenteditable as flat text, overlay styled spans via absolute positioning. Everything except the rendering strategy in TextEditableBlock survives this pivot. See the Fallback Plan section below.

### Inline parser algorithm: CommonMark delimiter-run

Two-phase approach per the CommonMark spec:

1. **Scan** — walk the content string, identify delimiter runs (`*`, `_`, `~~`), classify as opener/closer/both using left/right flanking rules. Also identify backtick spans, link brackets, etc.
2. **Match** — walk the delimiter list, match openers to closers using spec precedence rules. Build the tree by wrapping matched ranges.

### Staged implementation

| Stage | Scope | What it proves |
|-------|-------|----------------|
| 1 | InlineNode types, parser infra, backtick scanning, span rendering, cursor save/restore, per-input re-render | Full pipeline works end-to-end |
| 2 | Delimiter-run algorithm for `*`/`_`/`~~`, hard line breaks | Complex parsing with nesting |
| 3 | Link/image bracket matching, reference resolution, autolinks | Structured inline types with document-level context |

Each stage is independently shippable. Unrecognized inline syntax renders as plain text (current behavior).

## InlineNode Type System

Extends `core/nodes.ts`. Flat interface, same philosophy as CstNode — discriminate on `kind`, no class hierarchy.

```typescript
type InlineNodeKind =
    | 'text'
    | 'emphasis'
    | 'strong'
    | 'strikethrough'
    | 'inlineCode'
    | 'link'
    | 'image'
    | 'autolink'
    | 'hardLineBreak';

interface InlineNode {
    kind: InlineNodeKind;
    start: number;            // byte offset into parent block's raw
    end: number;              // byte offset into parent block's raw
    text?: string;            // text, inlineCode
    children?: InlineNode[];  // emphasis, strong, strikethrough, link
    url?: string;             // link, image, autolink
    title?: string;           // link, image
    alt?: string;             // image
}
```

`start`/`end` cover the full range in `raw` including markers. For `**bold**`, start is at the first `*`, end is after the last `*`. Every character in `raw` belongs to exactly one inline node's range.

Added to CstNode as optional:

```typescript
interface CstNode {
    // ... existing fields ...
    inlineContent?: InlineNode[];
}
```

Only populated on prose kinds (paragraph, heading, setextHeading).

## Inline Parser Architecture

New file: `core/inline-parser.ts`. Separate from the block parser.

### Entry point

```typescript
function parseInline(raw: string, contentStart: number, contentEnd: number): InlineNode[]
```

Takes the block's `raw` and the content range within it (after block-level markers). For a heading `## Hello **world**\n`, contentStart is 3 (after `## `), contentEnd is before `\n`. Produces `start`/`end` offsets relative to the full `raw`.

### Content range extraction

Each prose block kind has a different marker structure:

- **paragraph** — content is the entire raw minus trailing line ending
- **heading** — content starts after `# ` / `## ` / etc. (derivable from metadata.level)
- **setextHeading** — content is the first line(s), before the `===`/`---` underline

A helper function per kind extracts contentStart/contentEnd from raw + metadata.

### Parsing pipeline (priority order)

1. **Backtick spans** (inline code) — match backtick sequences, content is literal *(Stage 1)*
2. **Angle-bracket autolinks** — `<url>`, literal content *(Stage 3)*
3. **Hard line breaks** — trailing `\` or two spaces before `\n` *(Stage 2)*
4. **Delimiter runs** — classify `*`/`_`/`~~` using flanking rules, match via CommonMark algorithm, recurse for nesting *(Stage 2)*
5. **Link/image brackets** — `[text](url)` and `![alt](url)`, recurse into bracket content *(Stage 3)*
6. **Bare autolinks** — GFM bare URL detection *(Stage 3)*
7. **Remaining text** — unmatched content becomes `text` nodes

### Separation from block parser

The block parser does NOT call the inline parser. Inline parsing is triggered by the editor layer — in `updateNodeContent` (after re-parsing a block's raw) and during initial document load. Reasons:

- `parse()` is used in contexts that don't render (tree operations, tests, potential backend use) — no need to pay for inline work
- Avoids double parsing during editing (kind detection + rendering are separate concerns)
- Stage 3 link reference resolution needs document-level context the block parser doesn't have

## Span Rendering

### Rendering function

Pure function producing DOM nodes from the inline tree:

```typescript
function renderInlineNodes(nodes: InlineNode[]): DocumentFragment
```

Kind-to-DOM mapping:

| Kind | DOM output |
|------|-----------|
| text | Text node |
| inlineCode | marker spans (dim) + text node for content |
| emphasis | marker spans (dim) + `<em>` wrapping recursive children |
| strong | marker spans (dim) + `<strong>` wrapping recursive children |
| strikethrough | marker spans (dim) + `<s>` wrapping recursive children |
| link | marker spans for `[`, `](`, url, `)` + content span with recursive children |
| image | marker spans for `![`, `](`, url, `)` + alt text |
| autolink | styled span for URL |
| hardLineBreak | marker span for `\` or spaces + `<br>` |

**Key invariant:** Every character in `raw` has a corresponding text node in the DOM. Markers are visible text in dimmed spans. `textContent` of the contenteditable still equals `raw` (minus trailing line ending), preserving the existing `onInput` → `textContent` → `raw` flow.

### Integration with TextEditableBlock

Rendering decision:

- `node.inlineContent` exists and has length > 0 → build span tree via renderInlineNodes
- Otherwise → set textContent as today (flat text)

Code blocks, raw-editable blocks, containers — all unchanged.

## Cursor Save/Restore

### Save (DOM → raw offset)

Already solved. `getCursorOffset()` walks the DOM and counts characters. Since markers are visible text, textContent position = raw offset. Unchanged.

### Restore (raw offset → DOM position)

New function. Given a raw offset and the rendered span tree:

1. Walk `InlineNode[]` using `start`/`end` to find the containing node
2. Determine if offset falls in a marker region or content region (markers have known lengths)
3. Find the corresponding DOM text node — the span tree mirrors the inline tree structure
4. Compute local character offset within that text node
5. Create a collapsed Range and set the selection

The `renderInlineNodes` function annotates DOM elements with `data-start`/`data-end` attributes (or a parallel map) to maintain the inline node → DOM node correspondence.

### Edge cases

- **Cursor at node boundary:** prefer the right node (text after marker). Matches user expectation.
- **Cursor inside a marker:** valid position, target the marker's text node at correct local offset.
- **Empty inline content:** fall back to flat text cursor positioning.

## onInput Flow (Approach A)

Revised handler for prose blocks with inline content:

```
1. Read el.textContent → newText
2. Save cursor offset via getCursorOffset()
3. Call updateBlockContent(index, newText + '\n', preEditOffset)
   — updates raw, reparses block, detects kind changes
4. Call parseInline() on updated raw → new inlineContent
5. Rebuild span tree: el.replaceChildren(renderInlineNodes(inlineContent))
6. Restore cursor via setCursorFromRawOffset(savedOffset)
```

Steps 1-3 are the existing flow. Steps 4-6 are new.

**IME composition:** Suppress steps 4-6 during compositionstart → compositionend. The DOM stays dirty during composition, then on compositionend the full flow runs. Existing pattern, extended.

**Blocks without inline content:** Completely unchanged. New flow only activates for prose blocks with populated inlineContent.

**The $effect sync:** Still exists, still suppressed by userIsTyping. Handles external changes (undo, split, merge). When those fire, it rebuilds spans from inlineContent. The userIsTyping flag means "skip the effect, because onInput already handled the re-render."

## Fallback Plan (Approach C)

If Approach A proves unworkable, the fallback is a decorations layer:

- Revert TextEditableBlock to flat textContent editing (current behavior)
- Add an absolutely-positioned overlay rendering styled spans on top
- Editing surface has transparent text; overlay provides visuals
- Cursor, selection, IME all work on flat text

**Everything except rendering survives this pivot.** InlineNode types, inline parser, parseInline(), start/end offsets, testing — all unchanged. Only the rendering strategy in TextEditableBlock changes.

Stage 1 is the proving ground. If Approach A works for inline code spans, it works for everything. If it doesn't, pivot to C before investing in Stages 2 and 3.

## Testing Strategy

### Inline parser tests (`inline-parser.test.ts`)

**Round-trip property:** Concatenating all leaf text values and marker strings in the inline tree reproduces the original content range. The inline equivalent of `serialize(parse(source)) === source`.

**Metadata correctness:** Parse specific inputs and verify tree structure — node kinds, nesting, start/end offsets.

**Edge cases per stage:**
- Stage 1: backtick matching (mismatched lengths, escaped backticks, empty code spans)
- Stage 2: delimiter runs (overlapping `*`/`_`, odd/even lengths, unclosed delimiters, `***` ambiguity)
- Stage 3: nested brackets, reference resolution, bare URLs

### Content range extraction tests

Verify the helper extracting contentStart/contentEnd from each prose block kind:
- Paragraph: full raw minus trailing line ending
- Heading: after `# ` prefix (accounting for level)
- Setext heading: first line(s) before underline

### Cursor offset mapping tests (`cursor-mapping.test.ts`)

Test the restore function in isolation — given an inline tree and a raw offset, verify correct node + local offset. Pure function tests, no DOM needed.
