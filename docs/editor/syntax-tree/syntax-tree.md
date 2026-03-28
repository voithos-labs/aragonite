# GFM Concrete Syntax Tree — Design Spec

**Current status:** Phase 1 (block-level CST) is fully implemented. All GFM block types are parsed. The parser produces mutable plain objects (`CstNode` interface). Phase 2 (inline parsing) and Phase 3 (structured fields) are designed but not yet implemented.

## Goal

A TypeScript concrete syntax tree (CST) that parses GitHub Flavored Markdown into a recursive tree of block nodes, then reconstructs the original source without any loss. The primary invariant: `serialize(parse(source)) === source` for all valid inputs.

This CST is the foundation for a custom markdown editor (Obsidian-like). It is not a standalone deliverable — it exists to eventually power editing, rendering, and syntax-aware interaction.

## Evolutionary Architecture

The CST is designed around three phases. Each phase builds on the previous without requiring a rewrite. This progression is a core architectural decision — every block type follows this lifecycle independently.

### Phase 1 — Block-level CST with raw source (implemented)

Parse GFM into a recursive tree of block nodes. Each node stores its raw source text verbatim. Round-trip is guaranteed by construction: serialize = concatenate raw source down the tree. Metadata (heading level, fence marker, etc.) is extracted alongside the raw source but does not participate in serialization.

### Phase 2 — Inline syntax parsing

Extend prose block nodes (paragraph, heading, setext heading) to parse their text content into an inline node tree. `raw` remains authoritative — the inline tree is derived from it and re-parsed on every edit. The inline tree is a rendering cache, not a serialization input. `serialize()` still reads `raw` only.

Inline nodes are trees, not flat spans. Inline syntax nests — `**bold *and italic***` produces Strong containing [Text, Emphasis containing [Text]]. Each inline node carries byte offsets into the parent block's `raw` for cursor mapping.

The editor uses the inline tree to build a styled DOM (nested `<strong>`, `<em>`, `<code>` spans) instead of flat `textContent`. Markdown markers remain visible but are dimmed/styled. This is the "always-visible styled source" rendering mode.

See the "Inline Node Types" section below for the full type definitions.

### Phase 3 — Structured fields and optional syntax hiding

Two changes from Phase 2:

1. **Ownership flip**: The inline tree becomes authoritative. `raw` is derived from the inline tree for serialization. Editing operates on the tree directly (inserting text into nodes, toggling marks by wrapping/unwrapping).

2. **Block-level structured fields**: Decompose block-level `raw` into semantic fields (marker, content, line ending) per block type. Serialization shifts from "return raw" to "reassemble from fields."

Together, these enable:

- **Semantic editing**: e.g., change heading level by swapping the marker field, toggle bold by wrapping in a Strong node
- **Optional syntax hiding**: Markers can be hidden when a block is unfocused and shown when focused (Obsidian-style live preview), since they are now separate fields rather than substrings of `raw`

**The rule:** Every block type starts at Phase 1. It only moves to Phase 3 when the editor actively requires it. A block type that users don't meaningfully edit (e.g., thematic breaks) may never need to advance.

**Example of the progression for a heading (`## Hello World\n`):**

Phase 1:

```
{ kind: "heading", raw: "## Hello World\n", metadata: { level: 2 } }
// serialize → return raw verbatim
// inline content: not parsed
```

Phase 2:

```
{ kind: "heading", raw: "## Hello World\n", metadata: { level: 2 },
  inlineContent: [
    { kind: "text", text: "Hello World", start: 3, end: 14 }
  ] }
// serialize → return raw verbatim (inline tree is derived, not authoritative)
// inlineContent covers the content portion of raw (after the "## " marker)
// the editor knows the marker range from metadata — it renders "## " as dimmed
```

Phase 3:

```
{ kind: "heading", marker: "## ", lineEnding: "\n", metadata: { level: 2 },
  inlineContent: [
    { kind: "text", text: "Hello World" }
  ] }
// serialize → marker + serializeInline(inlineContent) + lineEnding
// editor can change level by swapping marker to "### "
```

**Catch-all for editing non-decomposed blocks:** Before a block type graduates to Phase 3, editing still works — the raw source is treated as a plain text string. The user types into it, raw is updated as a string, and the block is re-parsed to refresh metadata and inline content. The only thing lost compared to structured fields is semantic editing operations.

## Node Types and Tree Structure

### Categories

The tree has three categories of nodes:

- **Document** — the root node
- **Container blocks** — hold child nodes (Blockquote, List, ListItem)
- **Leaf blocks** — terminal nodes with no children

### Node Type

All nodes are **mutable plain objects** — no class hierarchy. There is one `CstNode` interface used everywhere: the parser produces it, the editor mutates it in place, serialization reads it. No immutable→mutable conversion step.

`CstNode` is a flat interface with optional fields for container structure and metadata. The editor discriminates on `kind` (a `BlockKind` string union) to determine behavior. Container fields (`children`, `innerPrefix`, `innerSuffix`) are present only on container kinds. Metadata is typed as a union of all metadata interfaces (`BlockMetadata`), narrowed manually after checking `kind`.

```
CstNode (flat interface, discriminated by `kind`)
├── Container kinds: blockquote, list, listItem
│   └── have: children, innerPrefix, innerSuffix
├── Prose kinds: paragraph, heading, setextHeading
│   └── will have: inlineContent (Phase 2, not yet implemented)
└── Other leaf kinds: fencedCode, thematicBreak, indentedCode,
    htmlBlock, linkReferenceDefinition, table, unrecognized
```

Why a flat interface instead of a mapped-type discriminated union: the editor's `updateNodeContent` mutates `kind` in place when a block type changes (e.g., paragraph → heading). A strict discriminated union would type `kind` as a literal per member, making in-place mutation a type error. The flat interface with `kind: BlockKind` allows this.

### Node Definitions

**Document** — root node:

```
Document {
  kind: "document"
  prefix: string          // leading blank lines / whitespace before first block
  children: CstNode[]     // container and leaf blocks
  suffix: string          // trailing whitespace after last block
}
```

**Container blocks:**

```
Blockquote {
  kind: "blockquote"
  leadingTrivia: string   // blank lines before this block in the parent context
  raw: string             // full source text including children
  innerPrefix: string     // leading blank lines inside the container, before first child
  children: CstNode[]
  innerSuffix: string     // trailing blank lines inside the container, after last child
  metadata: { quoteDepth: number }
}

List {
  kind: "list"
  leadingTrivia: string
  raw: string
  innerPrefix: string
  children: ListItem[]
  innerSuffix: string
  metadata: { ordered: boolean }
}

ListItem {
  kind: "listItem"
  leadingTrivia: string
  raw: string
  innerPrefix: string
  children: CstNode[]     // can contain paragraphs, code blocks, nested lists
  innerSuffix: string
  metadata: { marker: string, taskItem: boolean, taskChecked: boolean }
}
```

`innerPrefix` and `innerSuffix` on container blocks serve the same role as `Document.prefix` and `Document.suffix` — they capture leading/trailing blank lines inside the container that don't belong to any child. When the container's inner content is parsed recursively, the temporary `Document.prefix`/`suffix` from that parse become the container's `innerPrefix`/`innerSuffix`.

**Prose blocks** (leaf blocks that carry inline content in Phase 2):

```
{ kind: "heading",        leadingTrivia, raw, metadata: { level }, inlineContent? }
{ kind: "setextHeading",  leadingTrivia, raw, metadata: { level }, inlineContent? }
{ kind: "paragraph",      leadingTrivia, raw, inlineContent? }
```

`inlineContent` is `undefined` in Phase 1 and populated via inline parsing in Phase 2.

**Other leaf blocks:**

```
{ kind: "fencedCode",              leadingTrivia, raw, metadata: { fenceMarker, fenceLength, info, closed } }
{ kind: "thematicBreak",           leadingTrivia, raw, metadata: { marker } }
{ kind: "indentedCode",            leadingTrivia, raw }
{ kind: "htmlBlock",               leadingTrivia, raw }
{ kind: "linkReferenceDefinition", leadingTrivia, raw, metadata: { label } }
{ kind: "table",                   leadingTrivia, raw, metadata: { columnCount } }
{ kind: "unrecognized",            leadingTrivia, raw }
```

### Design Invariants

- **`raw` is the source of truth for serialization.** Metadata is derived from raw but never participates in round-trip.
- **`leadingTrivia`** captures blank lines between blocks in the parent context. Combined with `Document.prefix`/`suffix` and container `innerPrefix`/`innerSuffix`, every whitespace character in the source is accounted for.
- **Container blocks store `raw` as the full outer source text** (with `> ` prefixes, list markers, indentation, etc.). Children are a decomposition of the inner (stripped) content. The primary correctness invariant is document-level round-trip, not a per-node check. As a secondary test-time assertion, a `validateTree()` function can verify that stripping the container syntax from `raw` and serializing the children produce the same inner content: `stripContainerSyntax(node.raw) === node.innerPrefix + node.children.map(c => c.leadingTrivia + c.raw).join("") + node.innerSuffix`.
- **`unrecognized` is the catch-all kind.** Any syntax the parser doesn't recognize round-trips perfectly as an unrecognized block. When support for a new block type is added, it graduates from `unrecognized` to its own kind. No data loss at any stage.

### Serialization

Trivially recursive. At the document level, `raw` on each top-level node already contains the full outer source text, so serialization never needs to recurse into children — it just concatenates:

```
serialize(document) =
  document.prefix
  + document.children.map(node => node.leadingTrivia + node.raw).join("")
  + document.suffix
```

For test-time verification of container internals, the inner content can be reconstructed from children:

```
serializeChildren(container) =
  container.innerPrefix
  + container.children.map(node => node.leadingTrivia + node.raw).join("")
  + container.innerSuffix
```

This produces the stripped inner content (e.g., without `> ` prefixes for blockquotes). The invariant is: `stripContainerSyntax(container.raw) === serializeChildren(container)`.

### Inline Node Types (Phase 2)

Inline content is a tree of `InlineNode` objects representing the inline syntax within a prose block's content (the portion of `raw` after block-level markers). Each node carries `start` and `end` byte offsets into the parent block's `raw` for cursor mapping. The inline parser receives the content range (e.g., after `## ` for headings) and produces the tree for that range.

**Inline node kinds:**

| Kind | Fields | Description |
| ---- | ------ | ----------- |
| `text` | `text` | Plain text with no markup |
| `emphasis` | `children` | `*text*` or `_text_` |
| `strong` | `children` | `**text**` or `__text__` |
| `strikethrough` | `children` | `~~text~~` (GFM extension) |
| `inlineCode` | `text` | `` `code` `` — no nested children |
| `link` | `children`, `url`, `title?` | `[text](url "title")` or `[text][ref]` (reference-style reuses the same kind) |
| `image` | `alt`, `url`, `title?` | `![alt](url "title")` or `![alt][ref]` (reference-style reuses the same kind) |
| `autolink` | `url` | `<url>` or GFM bare URL |
| `hardLineBreak` | — | Trailing `\` or two spaces before `\n` |

Inline nodes nest. `**bold *and italic***` produces:

```
Strong { children: [
  Text { text: "bold " },
  Emphasis { children: [
    Text { text: "and italic" }
  ] }
] }
```

Each node (including wrapper nodes like Strong and Emphasis) has `start`/`end` offsets covering the full range in `raw`, including the markers. This allows the editor to map DOM cursor positions to `raw` offsets and vice versa.

**Relationship to `raw`:**

In Phase 2, `inlineContent` is **derived** from `raw`. It is a rendering cache — disposable and re-parsed whenever `raw` changes. The inline tree is never used for serialization. The invariant: concatenating all leaf `text` values and marker syntax in the inline tree reproduces the portion of `raw` that was parsed.

In Phase 3, the ownership flips: `inlineContent` becomes authoritative and `raw` is derived from it. See the Phase 3 section above.

## Parser Design

Single-pass, line-oriented scanner. Reads the source line by line and builds the tree top-down.

### Flow

```
source string
  → split into lines (preserving line endings)
  → scan lines, recognizing block openers
  → emit CstNode tree
```

### Algorithm

1. **Split** the source into lines, preserving `\n` or `\r\n` endings and tracking each line's start offset.

2. **Consume leading blank lines** into `Document.prefix`.

3. **Main loop** — for each line, try matchers in priority order:
   - Fenced code open (` ``` ` or `~~~`) → consume lines until matching close fence or EOF. A close fence must use the same character as the opener and have at least as many characters (e.g., a 4-backtick open requires 4+ backticks to close). The closing fence line must contain only the fence characters and optional trailing whitespace — no info string.
   - ATX heading (`#` through `######` followed by space or end of line)
   - Thematic break (`---`, `***`, `___` with optional spaces) — **only when preceded by a blank line or at document start.** A thematic-break-like line (`---`, `***`, `___`) immediately following a non-blank, non-container line must not be consumed as a thematic break, because `---` and `===` can be setext heading underlines (deferred to v2). In this case, the line is absorbed into the preceding paragraph. Note: `===` is never a thematic break in GFM (it is only a setext H1 underline), so it always falls through to paragraph/unrecognized. Applying the "preceded by blank line" rule consistently to all three markers (`-`, `*`, `_`) ensures forward compatibility with setext heading support.
   - Blockquote (`> `) → enter recursive context, parse inner content as children
   - List item (unordered: `- `, `* `, `+ `; ordered: one or more digits followed by `.` or `)` and a space) → enter recursive context, parse inner content as children
   - **Fallback** → start a paragraph, consume continuation lines until a blank line or a recognized block opener

4. **Between blocks**, blank lines accumulate as `leadingTrivia` on the next block.

5. **Trailing blank lines** after the last block become `Document.suffix`.

### Container Block Parsing

Blockquotes and list items are parsed recursively. When we recognize a `> ` prefix:

1. Collect all continuation lines belonging to this blockquote
2. Strip the `> ` prefix from each line
3. Parse the stripped content recursively (same algorithm) to get child nodes
4. Store the original (un-stripped) lines as `raw`

Same approach for list items — strip the indentation/marker, parse inner content recursively, keep the original as `raw`.

### Deliberately Out of Scope (Phase 1)

- **No inline parsing** — paragraph and heading content is opaque text in Phase 1. Inline parsing is defined in this spec (see "Inline Node Types") but implemented in Phase 2.
- **No incremental parsing** — full re-parse every time; incremental is an optimization for when editing is involved
- **No error recovery machinery** — unrecognized syntax falls through to `unrecognized` blocks or gets absorbed into a paragraph

## GFM Block Coverage

All GFM block types are implemented and have their own node kinds:

| Block Type                 | Kind                      | Notes                               |
| -------------------------- | ------------------------- | ----------------------------------- |
| ATX headings               | `heading`                 | `# ` through `###### `              |
| Setext headings            | `setextHeading`           | Underline-style `===` / `---`       |
| Paragraphs                 | `paragraph`               | Fallback for unstructured text      |
| Fenced code blocks         | `fencedCode`              | `` ``` `` and `~~~` with info string |
| Indented code blocks       | `indentedCode`            | 4-space indent                      |
| Blockquotes                | `blockquote`              | Container, recursive children       |
| Lists / list items         | `list` / `listItem`       | Ordered, unordered, task checkboxes |
| Thematic breaks            | `thematicBreak`           | `---`, `***`, `___` variants        |
| HTML blocks                | `htmlBlock`               | Raw `<div>`, `<table>`, etc.        |
| Link reference definitions | `linkReferenceDefinition` | `[ref]: url "title"`                |
| Tables                     | `table`                   | GFM extension, pipe syntax          |
| Unrecognized               | `unrecognized`            | Catch-all for unknown syntax        |

### Future — Inline Syntax (Phase 2)

| Inline Type                  | Notes                           |
| ---------------------------- | ------------------------------- |
| Emphasis / strong            | `*`, `_`, `**`, `__`            |
| Strikethrough                | `~~` (GFM extension)            |
| Inline code                  | Single backticks                |
| Links                        | `[text](url)`                   |
| Images                       | `![alt](url)`                   |
| Autolinks                    | Bare URLs and emails            |
| Hard line breaks             | Trailing `\` or two spaces      |
| Reference-style links/images | Uses link reference definitions |

### Future — Custom Extensions

The pattern for adding a new block type (standard or custom):

1. Add a new `kind` string to the `BlockKind` union
2. Optionally add a metadata interface to `MetadataMap`
3. Add parser recognition logic (matcher function + priority placement)
4. What was previously `unrecognized` for that syntax now gets its own typed node

This same pattern applies to hypothetical custom blocks (callouts, embedded queries, custom containers). The tree doesn't care what the kind string is — it only requires the node to be a `CstNode` with the standard fields.

## Testing Strategy

### Test Runner

Vitest — runs TypeScript natively via Vite, no compilation step. Test files live alongside source in `src/lib/editor/test/`.

### Test Tiers

**Tier 1 — Round-trip tests (must never fail):**

Feed a markdown string in, parse it, serialize it, assert exact string equality.

- Each block type in isolation
- Mixed documents with multiple block types
- Edge cases: empty document, only blank lines, no trailing newline, `\r\n` line endings, multiple consecutive blank lines
- Nested containers: blockquote containing a heading, list containing a code block, nested lists, blockquote containing a list

**Tier 2 — Metadata extraction tests:**

Parse specific inputs and assert the parser identifies correct block kinds and metadata values. Secondary to round-trip — if metadata is wrong but round-trip passes, that's a bug but not a data-loss bug.

**Tier 3 — Full block type coverage:**

Parse documents with all GFM block types and verify correct `kind` assignment and round-trip fidelity. Ensure no syntax falls through to `unrecognized` unless it genuinely isn't GFM.
