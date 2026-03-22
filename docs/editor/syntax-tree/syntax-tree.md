# GFM Concrete Syntax Tree — Design Spec

## Goal

A TypeScript concrete syntax tree (CST) that parses GitHub Flavored Markdown into a recursive tree of block nodes, then reconstructs the original source without any loss. The primary invariant: `serialize(parse(source)) === source` for all valid inputs.

This CST is the foundation for a custom markdown editor (Obsidian-like). It is not a standalone deliverable — it exists to eventually power editing, rendering, and syntax-aware interaction.

## Evolutionary Architecture

The CST is designed around three phases. Each phase builds on the previous without requiring a rewrite. This progression is a core architectural decision — every block type follows this lifecycle independently.

### Phase 1 — Block-level CST with raw source (this spec)

Parse GFM into a recursive tree of block nodes. Each node stores its raw source text verbatim. Round-trip is guaranteed by construction: serialize = concatenate raw source down the tree. Metadata (heading level, fence marker, etc.) is extracted alongside the raw source but does not participate in serialization.

### Phase 2 — Inline syntax parsing

Extend leaf block nodes to parse their text content into inline spans (bold, italic, code, links, images, autolinks, strikethrough, etc.). The raw source on the block still round-trips, but the tree now understands inline structure within blocks. This is necessary for syntax-aware rendering in the editor.

### Phase 3 — Structured fields for editor support

Decompose raw source into structured fields (marker, content, line ending, etc.) on a per-block-type basis, as needed by the editor. Serialization shifts from "return raw" to "reassemble from fields." This enables:

- **Semantic editing**: e.g., change heading level by swapping the marker field
- **Syntax-aware rendering**: e.g., style the `##` marker differently from the heading text (Obsidian-style live preview where the markup is visible and editable)

**The rule:** Every block type starts at Phase 1. It only moves to Phase 3 when the editor actively requires it. A block type that users don't meaningfully edit (e.g., thematic breaks) may never need to advance.

**Example of the progression for a heading (`## Hello World\n`):**

Phase 1:

```
Heading { raw: "## Hello World\n", level: 2 }
// serialize → return raw verbatim
```

Phase 3:

```
Heading { marker: "## ", content: "Hello World", lineEnding: "\n", level: 2 }
// serialize → marker + content + lineEnding
// editor can now change level by swapping marker to "### "
```

**Catch-all for editing non-decomposed blocks:** Before a block type graduates to Phase 3, editing still works — the raw source is treated as a plain text string. The user types into it, raw is updated as a string, and the block is re-parsed to refresh metadata. The only thing lost compared to structured fields is semantic editing operations.

## Node Types and Tree Structure

### Categories

The tree has three categories of nodes:

- **Document** — the root node
- **Container blocks** — hold child nodes (Blockquote, List, ListItem)
- **Leaf blocks** — terminal nodes with no children

### Class Hierarchy

```
CstNode (abstract base)
├── Document
├── ContainerBlock (abstract)
│   ├── Blockquote
│   ├── List
│   └── ListItem
└── LeafBlock (abstract)
    ├── Heading
    ├── Paragraph
    ├── FencedCode
    ├── ThematicBreak
    └── UnrecognizedBlock
```

`CstNode` defines the shared interface: `kind`, `leadingTrivia`, `raw`. `ContainerBlock` adds `children: CstNode[]`. `LeafBlock` is terminal. Each concrete class owns its own metadata type. Pattern matching on `kind` gives access to specific metadata.

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

**Leaf blocks:**

```
Heading {
  kind: "heading"
  leadingTrivia: string
  raw: string
  metadata: { level: number }
}

Paragraph {
  kind: "paragraph"
  leadingTrivia: string
  raw: string
}

FencedCode {
  kind: "fencedCode"
  leadingTrivia: string
  raw: string
  metadata: { fenceMarker: "`" | "~", fenceLength: number, info: string, closed: boolean }
}

ThematicBreak {
  kind: "thematicBreak"
  leadingTrivia: string
  raw: string
  metadata: { marker: string }
}

UnrecognizedBlock {
  kind: "unrecognized"
  leadingTrivia: string
  raw: string
}
```

### Design Invariants

- **`raw` is the source of truth for serialization.** Metadata is derived from raw but never participates in round-trip.
- **`leadingTrivia`** captures blank lines between blocks in the parent context. Combined with `Document.prefix`/`suffix` and container `innerPrefix`/`innerSuffix`, every whitespace character in the source is accounted for.
- **Container blocks store `raw` as the full outer source text** (with `> ` prefixes, list markers, indentation, etc.). Children are a decomposition of the inner (stripped) content. The primary correctness invariant is document-level round-trip, not a per-node check. As a secondary test-time assertion, a `validateTree()` function can verify that stripping the container syntax from `raw` and serializing the children produce the same inner content: `stripContainerSyntax(node.raw) === node.innerPrefix + node.children.map(c => c.leadingTrivia + c.raw).join("") + node.innerSuffix`.
- **`UnrecognizedBlock`** is the catch-all. Any syntax the parser doesn't recognize round-trips perfectly as an unrecognized block. When support for a new block type is added, it graduates from `UnrecognizedBlock` to its own kind. No data loss at any stage.

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

### Deliberately Out of Scope

- **No inline parsing** — paragraph and heading content is opaque text in Phase 1
- **No incremental parsing** — full re-parse every time; incremental is an optimization for when editing is involved
- **No error recovery machinery** — unrecognized syntax falls through to `UnrecognizedBlock` or gets absorbed into a paragraph

## GFM Coverage Roadmap

### v1 — Core Block Types (This Spec)

| Block Type         | Node Kind           | Notes                               |
| ------------------ | ------------------- | ----------------------------------- |
| ATX headings       | `Heading`           | `# ` through `###### `              |
| Paragraphs         | `Paragraph`         | Fallback for unstructured text      |
| Fenced code blocks | `FencedCode`        | ` ``` ` and `~~~` with info string  |
| Blockquotes        | `Blockquote`        | Container, recursive children       |
| Lists / list items | `List` / `ListItem` | Ordered, unordered, task checkboxes |
| Thematic breaks    | `ThematicBreak`     | `---`, `***`, `___` variants        |

### v2 — Deferred Block Types

These round-trip as `UnrecognizedBlock` in v1. Each graduates to its own node kind when implemented.

| Block Type                 | Future Node Kind          | Notes                         |
| -------------------------- | ------------------------- | ----------------------------- |
| Setext headings            | `SetextHeading`           | Underline-style `===` / `---` |
| Indented code blocks       | `IndentedCode`            | 4-space indent                |
| HTML blocks                | `HtmlBlock`               | Raw `<div>`, `<table>`, etc.  |
| Link reference definitions | `LinkReferenceDefinition` | `[ref]: url "title"`          |
| Tables                     | `Table`                   | GFM extension, pipe syntax    |

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

1. Define a new class extending `LeafBlock` or `ContainerBlock`
2. Add a unique `kind` string
3. Add parser recognition logic (matcher function + priority placement)
4. What was previously `UnrecognizedBlock` for that syntax now gets its own typed node

This same pattern applies to hypothetical custom blocks (callouts, embedded queries, custom containers). The tree doesn't care what the kind string is — it only requires the node to follow the `CstNode` contract.

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

**Tier 3 — Unrecognized block coverage:**

Feed in GFM syntax we deliberately defer (tables, setext headings, HTML blocks). Assert they round-trip as `UnrecognizedBlock` nodes without loss.
