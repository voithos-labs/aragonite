# Editor Changelog

## 0.3.1 — Bug Fixes

### Fixes

- Container raw propagation: editing inside a list item now correctly rebuilds the parent list's raw (was only rebuilding the list item, leaving the list stale for serialization)
- Same fix applied to blockquotes for consistency with deeply nested containers
- List item marker: parser now stores the full marker including trailing space (`"- "` instead of `"-"`), fixing raw reconstruction that dropped the space

## 0.3 — Inline Parsing

Inline syntax parsing for prose blocks (paragraphs, headings, setext headings). The inline tree is a rendering cache derived from `raw` — parsed on every edit, never used for serialization.

### Features

- InlineNode type system extending the CST
- Inline parser with staged pipeline:
  - Stage 1: backtick code span scanning, content range extraction
  - Stage 2: delimiter-run algorithm for emphasis/strong, strikethrough, hard line breaks
  - Stage 3: links, images, autolinks
- Inline renderer producing styled DOM fragments (dimmed markers, semantic elements)
- Cursor save/restore through the inline span tree
- Per-input re-render pipeline (read textContent → update raw → re-parse inline → rebuild spans → restore cursor)
- `isProseKind()` helper for canonical prose block identification

### Fixes

- Inline rendering invariant: markers extracted via `raw.slice()`, not reconstructed from parsed fields
- Hard line breaks use `\n` text nodes instead of `<br>` for browser-independent textContent

## 0.2 — Block Editing

Core editing loop and all block type components, including recursive container blocks.

### Features

- Editor shell with CST ownership, EditorActions context, and focus management
- BlockList, BlockHost component hierarchy with keyed `{#each}` rendering
- TextEditableBlock: shared contenteditable for paragraphs, headings, and raw-editable fallback
- CodeBlock: fenced code with textarea surface
- ThematicBreakBlock: non-editable, focusable
- BlockquoteBlock: recursive container with nested BlockList and EditorActions
- ListBlock / ListItemBlock: nested container blocks
- List Enter behavior: new item creation, content split, empty item exit
- Tree operations: split, merge, delete, updateContent
- Merge eligibility rules (paragraph+paragraph, heading+paragraph, etc.)
- Container raw reconstruction for blockquotes and lists
- Undo/redo with snapshot-based CST cloning and 500ms debounced batching
- Block identity via parallel ID array for stable Svelte keyed rendering
- Focus traversal with arrow keys across block boundaries
- CST unification: replaced class hierarchy with mutable plain objects

### Fixes

- Container block ID desync on undo/redo
- Leaf-to-container transition losing children
- Collapsed code block, empty container cursor loss, content overflow
- Editor re-initialization on async source prop change
- Double chars, cursor jump, empty block editing
- Merge newline handling, undo/redo state passing
- Zero-width empty paragraph block
- Empty documents start with one paragraph block

## 0.1 — CST Foundation

Block-level concrete syntax tree for GitHub Flavored Markdown with lossless round-trip serialization.

### Features

- Single-pass, line-oriented parser producing mutable CstNode tree
- All 14 GFM block types: paragraph, heading, setextHeading, fencedCode, indentedCode, thematicBreak, htmlBlock, linkReferenceDefinition, table, blockquote, list, listItem, unrecognized
- Recursive container parsing (blockquotes, lists)
- Metadata extraction (heading level, fence markers, list markers, task items, etc.)
- Lossless serialization: `serialize(parse(source)) === source`
- Leading/trailing trivia preservation for whitespace fidelity
- `unrecognized` catch-all for graceful degradation

### Tests

- Round-trip tests for all block types in isolation and combination
- Complex document round-trip tests with nested containers
- Metadata correctness tests
- Unrecognized block coverage
- Edge cases: setext/thematic disambiguation, cross-block interactions, empty docs, CRLF
