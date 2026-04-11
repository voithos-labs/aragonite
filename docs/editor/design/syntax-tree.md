# GFM Concrete Syntax Tree — Design Spec

## Goal

A TypeScript concrete syntax tree (CST) that parses GitHub Flavored Markdown into a recursive tree of block nodes, then reconstructs the original source without any loss. The primary invariant: `serialize(parse(source)) === source` for all valid inputs.

This CST is the foundation for a custom markdown editor (Obsidian-like). It is not a standalone deliverable — it exists to eventually power editing, rendering, and syntax-aware interaction.

## Evolutionary Architecture

The CST is designed around three phases. Each phase builds on the previous without requiring a rewrite. This progression is a core architectural decision — every block type follows this lifecycle independently.

### Phase 1 — Block-level CST with raw source

Parse GFM into a recursive tree of block nodes. Each node stores its raw source text verbatim. Round-trip is guaranteed by construction: serialize = concatenate raw source down the tree. Metadata (heading level, fence marker, etc.) is extracted alongside the raw source but does not participate in serialization.

### Phase 2 — Inline syntax parsing

Extend prose block nodes (paragraph, heading, setext heading) to parse their text content into an inline node tree. `raw` remains authoritative — the inline tree is derived from it and re-parsed on every edit. The inline tree is a rendering cache, not a serialization input. `serialize()` still reads `raw` only.

Inline nodes are trees, not flat spans. Inline syntax nests — `**bold *and italic***` produces Strong containing [Text, Emphasis containing [Text]]. Each inline node carries byte offsets into the parent block's `raw` for cursor mapping.

The editor uses the inline tree to build a styled DOM (nested `<strong>`, `<em>`, `<code>` spans) instead of flat `textContent`. Markdown markers remain visible but are dimmed/styled. This is the "always-visible styled source" rendering mode.

See the "Inline Node Types" section below for the full type definitions.

### Phase 3 — Rejected

Phase 3 proposed an ownership flip: the inline tree would become authoritative, `raw` derived from it. Block-level structured fields would decompose `raw` into semantic fields. This would have enabled tree-based semantic editing and optional syntax hiding (Obsidian-style markers hidden on unfocus).

**Decision: Phase 2 is the permanent architecture.** Phase 3 was evaluated after the editor reached maturity (v0.3.1, ~4,300 lines of source) and rejected for these reasons:

- **Round-trip fidelity.** Phase 2's `serialize(parse(source)) === source` is trivially maintained because serialization concatenates `raw`. Tree-as-truth requires the serializer to reproduce exact delimiter styles (`*italic*` vs `_italic_`), making round-trip fragile.
- **Partial syntax during typing.** `**bold` mid-typing is just a string in raw-as-truth. In tree-as-truth, it's an invalid tree state that every keystroke must handle.
- **Semantic editing already works.** Toggle bold = insert `**` around selection in `raw`. Change heading level = swap `# ` prefix. The editor already does this for kind changes. No tree manipulation needed.
- **Syntax hiding contradicts the design philosophy.** The editor's philosophy is "always-visible styled source." Syntax hiding is a cosmetic preference that doesn't justify an architectural phase.
- **Complexity cost.** Tree-DOM sync, fragile serialization, and new bug classes outweigh the benefits. Editors that adopted tree-as-truth (ProseMirror, Slate) pay an enormous complexity tax for it.

## Node Types and Tree Structure

### Categories

The tree has three categories of nodes:

- **Document** — the root node
- **Container blocks** — hold child nodes (Blockquote, List, ListItem)
- **Leaf blocks** — terminal nodes with no children

### Node Type

All nodes are **mutable plain objects** — no class hierarchy. There is one `CstNode` interface used everywhere: the parser produces it, the editor mutates it in place, serialization reads it. No immutable→mutable conversion step.

`CstNode` is a flat interface with optional fields for container structure and metadata. The editor discriminates on `kind` (a `BlockKind` string union) to determine behavior. Container fields (`children`, `innerPrefix`, `innerSuffix`) are present only on container kinds. Metadata is typed as a union of all metadata interfaces (`BlockMetadata`), narrowed manually after checking `kind`.

Node kind categories:

- **Container kinds** (blockquote, list, listItem) carry `children`, `innerPrefix`, and `innerSuffix`.
- **Prose kinds** (paragraph, heading, setextHeading) carry `inlineContent` (populated by the inline parser).
- **Other leaf kinds** (fencedCode, thematicBreak, indentedCode, htmlBlock, linkReferenceDefinition, table, unrecognized) have no children or inline content.

Why a flat interface instead of a mapped-type discriminated union: the editor's `updateNodeContent` mutates `kind` in place when a block type changes (e.g., paragraph → heading). A strict discriminated union would type `kind` as a literal per member, making in-place mutation a type error. The flat interface with `kind: BlockKind` allows this.

### Node Definitions

**Document** — the root node. Carries a `prefix` (leading blank lines/whitespace before the first block), an ordered list of `children` (container and leaf blocks), and a `suffix` (trailing whitespace after the last block).

**Container blocks:**

- **Blockquote** — carries `leadingTrivia` (blank lines before this block), `raw` (full source text including children), `innerPrefix`/`innerSuffix` (leading/trailing blank lines inside the container), `children`, and metadata with `quoteDepth`.
- **List** — same container fields as blockquote. Children are ListItem nodes. Metadata carries `ordered` (boolean).
- **ListItem** — same container fields. Children can be paragraphs, code blocks, nested lists, etc. Metadata carries the `marker` string, `taskItem` flag, and `taskChecked` flag.

`innerPrefix` and `innerSuffix` on container blocks serve the same role as `Document.prefix` and `Document.suffix` — they capture leading/trailing blank lines inside the container that don't belong to any child. When the container's inner content is parsed recursively, the temporary `Document.prefix`/`suffix` from that parse become the container's `innerPrefix`/`innerSuffix`.

**Prose blocks** (leaf blocks that carry inline content in Phase 2):

- **heading** — `leadingTrivia`, `raw`, metadata with `level`, and optional `inlineContent`.
- **setextHeading** — same shape as heading.
- **paragraph** — `leadingTrivia`, `raw`, and optional `inlineContent` (no metadata).

`inlineContent` is `undefined` in Phase 1 and populated via inline parsing in Phase 2.

**Other leaf blocks** — all carry `leadingTrivia` and `raw`. Metadata varies by kind:

- **fencedCode** — metadata: `fenceMarker`, `fenceLength`, `info`, `closed`.
- **thematicBreak** — metadata: `marker`.
- **indentedCode** — no metadata.
- **htmlBlock** — no metadata.
- **linkReferenceDefinition** — metadata: `label`.
- **table** — metadata: `columnCount`.
- **unrecognized** — no metadata (catch-all for unknown syntax).

### Design Invariants

- **`raw` is the source of truth for serialization.** Metadata is derived from raw but never participates in round-trip.
- **`leadingTrivia`** captures blank lines between blocks in the parent context. Combined with `Document.prefix`/`suffix` and container `innerPrefix`/`innerSuffix`, every whitespace character in the source is accounted for.
- **Container blocks store `raw` as the full outer source text** (with `> ` prefixes, list markers, indentation, etc.). Children are a decomposition of the inner (stripped) content. The primary correctness invariant is document-level round-trip, not a per-node check. As a secondary test-time assertion, a `validateTree()` function can verify that stripping the container syntax from `raw` and serializing the children produce the same inner content: `stripContainerSyntax(node.raw) === node.innerPrefix + node.children.map(c => c.leadingTrivia + c.raw).join("") + node.innerSuffix`.
- **`unrecognized` is the catch-all kind.** Any syntax the parser doesn't recognize round-trips perfectly as an unrecognized block. When support for a new block type is added, it graduates from `unrecognized` to its own kind. No data loss at any stage.

### Serialization

Trivially recursive. At the document level, `raw` on each top-level node already contains the full outer source text, so serialization never needs to recurse into children. It concatenates the document prefix, then each child's leading trivia and raw source in order, then the document suffix.

For test-time verification of container internals, the inner content can be reconstructed from children by concatenating the container's inner prefix, each child's leading trivia and raw source, and the inner suffix. This produces the stripped inner content (e.g., without `> ` prefixes for blockquotes). The invariant is: stripping the container syntax from `raw` yields the same result as serializing the children.

### Inline Node Types (Phase 2)

Inline content is a tree of `InlineNode` objects representing the inline syntax within a prose block's content (the portion of `raw` after block-level markers). Each node carries `start` and `end` byte offsets into the parent block's `raw` for cursor mapping. The inline parser receives the content range (e.g., after `## ` for headings) and produces the tree for that range.

**Inline node kinds:**

| Kind            | Fields                      | Description                                                                   |
| --------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `text`          | `text`                      | Plain text with no markup                                                     |
| `emphasis`      | `children`                  | `*text*` or `_text_`                                                          |
| `strong`        | `children`                  | `**text**` or `__text__`                                                      |
| `strikethrough` | `children`                  | `~~text~~` (GFM extension)                                                    |
| `inlineCode`    | `text`                      | `` `code` `` — no nested children                                             |
| `link`          | `children`, `url`, `title?` | `[text](url "title")` or `[text][ref]` (reference-style reuses the same kind) |
| `image`         | `alt`, `url`, `title?`      | `![alt](url "title")` or `![alt][ref]` (reference-style reuses the same kind) |
| `autolink`      | `url`                       | `<url>` or GFM bare URL                                                       |
| `hardLineBreak` | —                           | Trailing `\` or two spaces before `\n`                                        |

Inline nodes nest. For example, `**bold *and italic***` produces a Strong node containing a Text child ("bold ") and an Emphasis child, which itself contains a Text child ("and italic"). Each node (including wrapper nodes like Strong and Emphasis) has `start`/`end` offsets covering the full range in `raw`, including the markers. This allows the editor to map DOM cursor positions to `raw` offsets and vice versa.

**Relationship to `raw`:**

In Phase 2, `inlineContent` is **derived** from `raw`. It is a rendering cache — disposable and re-parsed whenever `raw` changes. The inline tree is never used for serialization. The invariant: concatenating all leaf `text` values and marker syntax in the inline tree reproduces the portion of `raw` that was parsed.

Phase 3 (ownership flip to tree-as-truth) was evaluated and rejected — Phase 2 is the permanent architecture. See the Phase 3 section above for rationale.

## Parser Design

Single-pass, line-oriented scanner. Reads the source line by line and builds the tree top-down.

### Flow

The parser takes a source string, splits it into lines (preserving line endings), scans lines to recognize block openers, and emits a CstNode tree.

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

### Block Parser Scope Boundaries

- **Inline parsing is separate** — the block parser does not parse inline syntax. Inline parsing is triggered by the editor layer, not the block parser (see inline-parsing.md).
- **No incremental parsing** — full re-parse every time; incremental is an optimization that can be added later without architectural changes.
- **No error recovery machinery** — unrecognized syntax falls through to `unrecognized` blocks or gets absorbed into a paragraph.

## GFM Block Coverage

All GFM block types are implemented and have their own node kinds:

| Block Type                 | Kind                      | Notes                               |
| -------------------------- | ------------------------- | ----------------------------------- |
| ATX headings               | `heading`                 | `# ` through `###### `              |
| Setext headings            | `setextHeading`           | Underline-style `===` / `---`       |
| Paragraphs                 | `paragraph`               | Fallback for unstructured text      |
| Fenced code blocks         | `fencedCode`              | ` ``` ` and `~~~` with info string  |
| Indented code blocks       | `indentedCode`            | 4-space indent                      |
| Blockquotes                | `blockquote`              | Container, recursive children       |
| Lists / list items         | `list` / `listItem`       | Ordered, unordered, task checkboxes |
| Thematic breaks            | `thematicBreak`           | `---`, `***`, `___` variants        |
| HTML blocks                | `htmlBlock`               | Raw `<div>`, `<table>`, etc.        |
| Link reference definitions | `linkReferenceDefinition` | `[ref]: url "title"`                |
| Tables                     | `table`                   | GFM extension, pipe syntax          |
| Unrecognized               | `unrecognized`            | Catch-all for unknown syntax        |

### Inline Syntax

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

### Custom Extensions

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
