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

**Decision: Phase 2 is the permanent architecture.** Phase 3 was evaluated after the editing loop matured and rejected for these reasons:

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

Why a flat interface instead of a mapped-type discriminated union: the editor mutates `kind` in place when a block type changes (e.g., paragraph → heading). A strict discriminated union would make in-place mutation a type error.

### Node Shape

All nodes carry `leadingTrivia` (blank lines before the block) and `raw` (full source text). The root `Document` additionally carries `prefix`/`suffix` for document-level whitespace.

**Container blocks** (blockquote, list, listItem) add `children`, `innerPrefix`/`innerSuffix` (leading/trailing whitespace inside the container), and kind-specific metadata. Container `raw` includes the outer syntax (e.g., `> ` prefixes). Children are a decomposition of the inner (stripped) content.

**Prose blocks** (paragraph, heading, setextHeading) add optional `inlineContent` — the inline node tree populated by Phase 2 parsing. A rendering cache derived from `raw`, never used for serialization.

**Other leaf blocks** carry kind-specific metadata where applicable. The `unrecognized` kind is the catch-all — any syntax the parser doesn't recognize round-trips as an unrecognized block.

### Design Invariants

- **`raw` is the source of truth for serialization.** Metadata is derived from raw but never participates in round-trip.
- **`leadingTrivia`** captures blank lines between blocks in the parent context. Combined with `Document.prefix`/`suffix` and container `innerPrefix`/`innerSuffix`, every whitespace character in the source is accounted for.
- **Container blocks store `raw` as the full outer source text** (with `> ` prefixes, list markers, indentation, etc.). Children are a decomposition of the inner (stripped) content. The primary correctness invariant is document-level round-trip. A secondary invariant: stripping the container syntax from `raw` produces the same result as serializing the children.
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

### Algorithm

Single-pass, line-oriented scanner. Takes a source string, splits into lines, matches each against block openers in priority order:

1. Fenced code → consume until matching close fence or EOF
2. ATX heading
3. Thematic break (only after a blank line, to avoid ambiguity with setext underlines)
4. Blockquote → recursive parse of stripped inner content
5. List item → recursive parse of stripped inner content
6. Fallback → start a paragraph, consume continuation lines

Blank lines between blocks become `leadingTrivia` on the next block. Leading/trailing document whitespace becomes `Document.prefix`/`suffix`.

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

New block types are additive — a kind string, optional metadata, and a parser matcher. Unrecognized syntax graduates to its own kind. The tree is agnostic to kind strings.

