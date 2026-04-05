# Block Editor — Design Spec

## Goal

A block-based markdown editor for Limestone that renders and edits GFM documents using the CST as its structural backbone. Each CST block node maps to an independent editing component. The editor supports the full GFM spec, is extensible to custom block types, and evolves alongside the CST's three-phase architecture (raw source → inline parsing → structured fields).

The primary design principles:

- The CST is the single source of truth for document structure
- Each block is an independent editing unit with its own rendering surface
- Cross-block coordination flows through a minimal, typed interface
- Adding a new block type is an additive operation — a new component and a registry entry

## Architecture Overview

### Component Hierarchy

```
Editor (shell — owns CST, undo stack, EditorActions context)
  └─ BlockList (keyed {#each} over CST children)
       ├─ BlockHost (resolves component by node.kind)
       │    ├─ TextEditableBlock (paragraph, heading, setextHeading, raw-editable)
       │    ├─ CodeBlock (fenced code — textarea surface)
       │    ├─ ThematicBreakBlock (non-editable, focusable)
       │    ├─ BlockquoteBlock (container — nested BlockList)
       │    └─ ListBlock (container — ListItemBlock children, each with nested BlockList)
       └─ ...
```

- **Editor** — top-level shell. Owns the CST `Document`, the undo stack, and the `EditorActions` context. Manages focus after structural operations using `await tick()`.
- **BlockList** — renders the CST children array via a keyed `{#each}`.
- **BlockHost** — given a CST node, resolves which block component to render by `node.kind`. Thin wrapper.
- **TextEditableBlock** — shared contenteditable surface for paragraphs, headings, and raw-editable block types, parameterized by CSS class.
- **Container block components** — `BlockquoteBlock` and `ListBlock`/`ListItemBlock` each host a nested `BlockList` with their own `EditorActions` context.

### Data Flow

```
Block detects boundary event (Enter, Backspace at pos 0, arrow at edge)
  → Calls EditorActions context function
  → Editor shell mutates the CST document tree
  → Svelte reactivity re-renders affected blocks
  → Editor calls focus() on the target block after await tick()
```

Four communication channels:

| Direction      | Mechanism                           | What Flows                                        |
| -------------- | ----------------------------------- | ------------------------------------------------- |
| Block → Editor | Context callbacks (`EditorActions`) | Boundary events: split, merge, delete, move focus |
| Editor → CST   | Direct tree mutation                | Structural changes to the document tree           |
| CST → Blocks   | Svelte reactivity                   | Blocks re-render from new tree state              |
| Editor → Block | Component refs (`bind:this`)        | `focus(offset)` for focus management              |

## The Editing Surface

### Per-Block Architecture

The document renders as a vertical stack of block components, one per CST node. Each block is an independent editing unit that chooses its own internal editing surface:

- Text blocks (paragraphs, headings) use `contenteditable`
- Code blocks could use `contenteditable`, a `<textarea>`, or an embedded CodeMirror
- Tables could use a grid of inputs/cells
- Non-editable blocks (thematic breaks, images) render as static elements with focus support

Not all blocks require `contenteditable`. A block only needs to conform to the common interface.

### Block Interface

```typescript
interface BlockComponent {
	// Focus management — optional, some blocks aren't text-editable
	focus?(offset: number): void;
	getCursorOffset?(): number | null;

	// Selection — optional, same reason
	getSelectedText?(): string;
	setSelection?(start: number, end: number): void;

	// Identity
	readonly editable: boolean; // can this block receive text input?
	readonly focusable: boolean; // can this block receive focus at all?
}
```

Examples:

- `TextEditableBlock` (paragraph, heading, raw): `{ editable: true, focusable: true }` — contenteditable, parameterized by CSS class
- `CodeBlock`: `{ editable: true, focusable: true }` — textarea editing surface
- `ThematicBreakBlock`: `{ editable: false, focusable: true }` — arrow-key navigable, Enter creates a paragraph below, Backspace deletes it
- `BlockquoteBlock`, `ListBlock`, `ListItemBlock`: `{ editable: true, focusable: true }` — containers delegate focus to inner children
- `ImageBlock` (future): `{ editable: false, focusable: true }` — focusable for keyboard navigation and deletion

The orchestration layer checks `editable`/`focusable` before calling `focus()` or `getCursorOffset()`.

### Rendering Mode

Always-visible styled source. Markdown syntax is visible at all times but styled:

- Markers (`##`, `**`, ` ``` `) are dimmed or colored
- Content is styled according to its meaning (headings are large/bold, code is monospace, emphasis is italic)
- No focus/unfocus mode switching
- One rendering path per block type

The Obsidian-style "hide syntax on unfocus" can be layered on later via Phase 3 structured CST fields as an optional user preference. It is a cosmetic enhancement, not an architectural decision.

This rendering mode maps naturally to the CST evolution:

- **Phase 1 (raw source)**: Block-level styling only — headings are large, code blocks have a monospace background
- **Phase 2 (inline parsing)**: Inline syntax gets styled — bold text is bold even with visible `**`
- **Phase 3 (structured fields)**: Optional hide-on-unfocus becomes possible since markers are separate fields

## CST Mutability

The CST uses mutable plain objects — no class hierarchy, no `readonly` fields on CST nodes. The parser produces mutable `CstNode` objects directly. The editor mutates them in place during editing (updating `raw`, replacing children, etc.). There is no immutable→mutable conversion step.

This means:

- `parse(source)` produces a mutable `Document` with `CstNode` children
- The editor works with these nodes directly — no wrapping or cloning on load
- Edits mutate nodes in place
- Single-block re-parse uses `parse()` on the block's `raw` text, then transfers the result into the existing tree
- Undo uses deep clones (`cloneDocument`) to snapshot state before mutations
- `serialize()` reads `raw` fields only — structurally typed, works on any object with the right shape

## CST ↔ DOM Synchronization

The CST is the document-level source of truth. Within a single block during active editing, the DOM leads and the CST follows.

### Normal Text Input

1. User types in a block's contenteditable
2. Browser updates the DOM immediately
3. `input` event fires — read `element.textContent`
4. Update the CST node's `raw` field to match
5. Re-parse the single block to refresh metadata — this uses `parse()` on just the block's `raw` text and reads the resulting node's kind and metadata. Note: single-block re-parse must use the full `parseNextBlock` pathway (or equivalent) with appropriate context, not just pattern matching, so that context-dependent block type recognition (e.g., indented code cannot interrupt a paragraph) works correctly.
6. In Phase 2+: re-parse inline content from the updated `raw` to refresh `inlineContent`
7. Check: did the block's structural interpretation change? (e.g., paragraph → heading)
8. If no (the common case) — done, DOM and CST agree
9. If yes — re-render the block from the CST (swap component type, update styling)

**Phase 2 rendering note:** Once inline parsing is active, the CST→DOM sync for prose blocks changes from setting `textContent` (flat string) to building a styled span tree from `inlineContent`. Markdown markers are rendered as dimmed spans, content is styled (bold, italic, etc.). Cursor offset math is unchanged — offsets still map to positions in `raw`, the DOM just has nested spans instead of a single text node.

### Intercepted Operations

These operations are handled by the editor, not the browser:

| Operation          | Trigger                                                     | Behavior                                                          |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Enter              | `keydown` → `preventDefault`                                | Split CST node at cursor offset, render two blocks                |
| Backspace at start | `keydown` → `preventDefault`                                | Merge with previous CST node via orchestrator                     |
| Paste              | `paste` → `preventDefault`                                  | Read `clipboardData.getData('text/plain')`, apply to CST          |
| Undo/Redo          | `keydown` Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z → `preventDefault` | Pop/push from undo stack                                          |
| Copy               | `copy` → `preventDefault`                                   | Read selected range from CST `raw`, write plain text to clipboard |
| Cut                | `cut` → `preventDefault`                                    | Copy from CST, then delete selected range, update CST             |

### IME Composition

During `compositionstart` → `compositionend`, the editor does not sync or reconcile. The browser owns the input throughout the composition sequence. After `compositionend` fires, read `textContent` and sync to CST.

### Key Invariant

The CST is always up-to-date (updated on every input event). The DOM is only patched when the CST's structural interpretation diverges from what is currently rendered. This avoids fighting the browser for normal typing while guaranteeing correctness on structural boundaries.

## Orchestration

### Upward Communication (Block → Editor)

Blocks receive typed callback functions via Svelte `getContext`:

```typescript
interface EditorActions {
	splitBlock(blockIndex: number, offset: number): void | Promise<void>;
	mergeWithPrevious(blockIndex: number): void | Promise<void>;
	deleteBlock(blockIndex: number): void | Promise<void>;
	moveFocus(blockIndex: number, position: 'start' | 'end' | number): void | Promise<void>;
	updateBlockContent(blockIndex: number, text: string, preEditOffset?: number): void;
	requestUndo(): void | Promise<void>;
	requestRedo(): void | Promise<void>;

	// Container block support — called by nested EditorActions contexts
	beginContainerEdit?(blockIndex: number, offset: number): void;
	beginContainerEditDebounced?(blockIndex: number, offset: number): void;
	endContainerEdit?(): void;
}
```

Structural operations return `void | Promise<void>` because they use `await tick()` for post-render focus management. The three container methods are optional — only called by container block components to coordinate undo snapshots and reactivity with the parent editor.

No signal dispatcher, no string matching, no performer registry, no reindexing. Blocks call typed functions directly.

### Downward Communication (Editor → Block)

The editor only needs to reach down to blocks for focus management. This uses component refs (`bind:this`). After a structural CST mutation and `await tick()`, the editor calls `blockRefs[targetIndex].focus(offset)`.

### Structural Operations

All structural operations are CST tree mutations performed by the editor shell. Blocks never modify the tree structure.

**Split** — take `node.raw`, cut at the text offset, create two new CST nodes, replace the original in the document's children array. The original block keeps its ID; the new block gets a fresh ID.

The `offset` parameter is relative to `raw` — it includes any syntax markers. The block component is responsible for translating the contenteditable cursor position to a `raw` offset (accounting for any markers rendered in the DOM). Splitting a heading `## Hello World\n` at raw offset 8 (between "Hello" and " World") produces `## Hello\n` (remains a heading) and ` World\n` (re-parses as a paragraph). The marker is not duplicated — the second half is a new block whose type is determined by re-parsing.

**Merge** — take two adjacent CST nodes, concatenate their `raw` text, replace both with one node, re-parse to determine the merged block's type. The surviving block keeps its ID.

Merge eligibility: merge is only attempted between compatible block types. Rules:

- Two paragraphs: always mergeable (concatenate raw text)
- Paragraph following a heading: mergeable (heading absorbs paragraph text, stays a heading)
- Two headings: not mergeable (Backspace at start of second heading moves focus to end of previous heading instead)
- Any block following a non-editable block (thematic break, image): not mergeable (Backspace deletes the non-editable block)
- Fenced code, tables, HTML blocks: not mergeable (Backspace at start moves focus to end of previous block)

When merge is not eligible, Backspace at the start of a block either deletes the previous block (if non-editable) or moves focus to the end of the previous block (if editable).

**Delete** — remove the node from the children array.

**Reorder** — move the node within the children array. IDs don't change.

**Block type change** (via re-parse) — when re-parsing a block's updated `raw` produces a different block kind, the node is replaced with a new node of the correct type. The ID is preserved.

### Focus Traversal

Arrow key navigation at block boundaries:

- **ArrowUp** at the top visual line of a block, or **ArrowLeft** at offset 0: trigger `moveFocus` to the previous block with `position: 'end'`
- **ArrowDown** at the bottom visual line of a block, or **ArrowRight** at the end of content: trigger `moveFocus` to the next block with `position: 'start'`
- Detecting "top visual line" vs "middle of block" requires geometry measurement: compare the cursor's bounding rect before and after the arrow key press. If the rect didn't change vertically, the cursor didn't move — it's at the boundary.
- `moveFocus` skips non-focusable blocks. For non-editable but focusable blocks (thematic breaks), `position` is ignored — the block receives a whole-block focus highlight.
- `focus(offset)` on non-editable blocks ignores the offset parameter. The block highlights itself as focused. Enter on a focused non-editable block creates a new paragraph below it. Backspace deletes it.

## Container Blocks (Recursive Nesting)

The CST has container blocks — `Blockquote`, `List`, and `ListItem` — which hold nested children. A document like:

```markdown
> Hello
>
> World

Some text
```

produces `Document.children` with two elements: a `Blockquote` (containing two Paragraphs) and a `Paragraph`. The inner paragraphs of the blockquote are not addressable by a flat document-level `blockIndex`.

### Recursive Editor Architecture

Container blocks are handled through **recursive composition**: a container block component hosts its own nested `BlockList`, reusing the same orchestration machinery. This means:

- A `BlockquoteBlock` component renders a `BlockList` for its inner children
- A `ListBlock` renders `ListItemBlock` children, each of which renders its own nested `BlockList`
- Each nested `BlockList` provides its own `EditorActions` context scoped to that nesting level
- Boundary events from inner blocks bubble up through nesting levels

This aligns with the principle that "adding a block type is an additive operation." A `BlockquoteBlock` is just another block component — it happens to contain a recursive `BlockList` inside it.

### Addressing

`EditorActions` uses `blockIndex` relative to the **local** children array at each nesting level. When a `ParagraphBlock` inside a blockquote calls `splitBlock(1, offset)`, it operates on index 1 of the blockquote's inner children, not the document's top-level children.

The nested `BlockList` inside a container block creates its own `EditorActions` context that wraps the parent's context. It handles local operations (split, merge, focus traversal within the container) directly, and delegates to the parent context for operations that cross the container boundary (e.g., Backspace at the start of the first child should merge with or exit the container).

### Focus Traversal Through Containers

- **ArrowDown** from the last line of a block inside a container: first try to move to the next sibling within the container. If at the last sibling, the inner `BlockList` signals upward to the container, which signals to the parent `BlockList` to move focus to the next block after the container.
- **ArrowUp** from the first line of the first child: the inner `BlockList` signals upward, and focus moves to the block before the container in the parent `BlockList`.
- **Entering a container**: when focus moves to a container block from the outside (ArrowDown into a blockquote), focus goes to the first (or last, depending on direction) editable child inside it.

### Container-Specific Operations

- **Splitting inside a container**: splits the inner child, not the container. The container's `raw` is reconstructed from its children.
- **Deleting all children of a container**: removes the entire container from the parent.
- **Backspace at start of first child**: Moves focus to the block before the container. The design allows for future unwrap behavior (lifting a child out of a blockquote, or unindenting a list item).
- **Enter in a list item**: Creates a new sibling list item. Enter at the end of a list item's content inserts a new item below; Enter in the middle splits the content across two items. Enter in an empty list item exits the list.

### Impact on Block Identity and Selection

Block identity (`blockIds`) is maintained per `BlockList` — each nesting level has its own ID array. Cross-block selection within a container uses the same `EditorSelection` model scoped to that container's `BlockList`. Cross-container selection (selecting from inside a blockquote to outside it) requires the cross-block selection system.

## Selection

### Single-Block Selection

Native browser selection within the block's contenteditable. No custom handling for rendering. Copy/cut are intercepted (see Clipboard section) but selection highlighting is native.

### Cross-Block Selection Model

```typescript
interface EditorSelection {
	anchor: { blockIndex: number; offset: number };
	focus: { blockIndex: number; offset: number };
}
```

When `anchor.blockIndex === focus.blockIndex`, it is a single-block selection and the browser handles it. When they differ, the editor takes over all selection rendering.

### Entering Cross-Block Selection

1. User starts a drag within block A — native selection within the contenteditable
2. Pointer crosses into block B — the editor detects this via pointer events on block containers
3. Editor records the anchor position, clears the native selection, switches to custom rendering
4. As the pointer moves, `EditorSelection.focus` updates

Also triggered by Shift+click in a different block, or Shift+ArrowDown from the end of a block.

### Cross-Block Selection Rendering

All rendering is custom — no native browser selection is used during cross-block selection:

- **Partially-selected blocks** (first and last): Use `Range` + `getClientRects()` to measure the text positions within the contenteditable, then render positioned highlight overlay elements matching those rects. Handles text wrapping correctly (multiple rects for multiple visual lines).
- **Fully-selected middle blocks**: A simple CSS overlay covering the entire block element.
- **Non-text blocks** (thematic break, image) in the selected range: Full-block highlight overlay.

### Exiting Cross-Block Selection

User clicks anywhere (collapsing the selection) or presses an arrow key without Shift. Clear all overlays, return to native single-block selection.

### Select All

First Ctrl+A: select all text within the focused block (native). Second Ctrl+A: select the entire document (cross-block, anchor at start of first block, focus at end of last block).

## Clipboard

Clipboard content is always plain markdown text, sourced from the CST. No HTML clipboard format, no browser-default copy behavior. All clipboard operations are intercepted in every context (single-block and cross-block).

### Copy (Ctrl+C)

**Single-block**: Get the selection range from the focused block. Slice the CST node's `raw` at those offsets. Write to clipboard via `navigator.clipboard.writeText()`.

**Cross-block**: Read the selection state from `EditorSelection`. For the anchor block, extract text from offset to end of `raw`. For middle blocks, take `leadingTrivia + raw` (leading trivia is included deliberately to preserve inter-block spacing — blank lines between blocks are part of the document structure and should be preserved in the clipboard). For the focus block, extract text from start of `raw` to offset. Concatenate and write to clipboard.

### Cut (Ctrl+X)

Copy (as above), then delete the selected range:

1. Truncate the anchor block's CST node at the anchor offset
2. Remove all fully-selected middle blocks from the CST
3. Truncate the focus block's CST node at the focus offset
4. Merge the remaining anchor and focus nodes into one, re-parse to determine block type
5. Push undo snapshot, re-render

### Paste (Ctrl+V)

Always intercepted:

1. `preventDefault`
2. Read `clipboardData.getData('text/plain')`
3. If there is a selection (single or cross-block), delete the selected range first
4. Parse the pasted text through the CST parser — produces a mini `Document` with block nodes
5. If the paste produces a single block with no structural markers: insert the text inline at the cursor position within the current block's `raw`
6. If the paste produces multiple blocks: split the current block at the cursor, insert the parsed blocks between the two halves, merge the boundaries if the block types are merge-eligible (see merge eligibility rules in Structural Operations)
7. Push undo snapshot, re-render, set focus at the end of the pasted content

## Undo/Redo

### Unified Undo Stack

All changes go through a single undo system. The browser's built-in contenteditable undo is disabled by intercepting `beforeinput` with `inputType: 'historyUndo'` / `'historyRedo'`.

### Interface

```typescript
interface UndoEntry {
	snapshot: Document;
	blockIds: string[];
	focusBlockIndex: number;
	focusOffset: number;
}

interface UndoManager {
	push(entry: UndoEntry): void;
	undo(currentState: UndoEntry): UndoEntry | null;
	redo(currentState: UndoEntry): UndoEntry | null;
	clear(): void;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
}
```

Each undo entry stores the full document snapshot, the block ID array (so undo/redo preserves Svelte's keyed DOM identity), and the focus position for cursor restoration. `undo()` and `redo()` take the current state as a parameter so the opposite stack can capture it (undo pushes current state onto redo stack, redo pushes onto undo stack). The caller clones the document before pushing.

The default implementation stores cloned CST `Document` trees. The CST is a lightweight tree of strings — cloning is cheap. The stack is capped at 200 entries to prevent unbounded memory growth during long editing sessions. If the Automerge history layer proves suitable for session-level undo later, the implementation behind this interface can be swapped without touching the editor.

### When Snapshots Are Pushed

- Before every structural operation (split, merge, delete block, reorder)
- Before every clipboard operation (cut, paste)
- On text input, batched: consecutive keystrokes within the same block are grouped into one undo entry. A new entry is created when:
  - The user pauses typing (~500ms debounce)
  - The user moves focus to a different block
  - A structural or clipboard operation occurs

### Undo Behavior

1. Pop the previous entry from the stack
2. Replace the current CST `Document` with the entry's snapshot
3. Restore `blockIds` from the entry (preserves DOM identity — Svelte reuses existing block components instead of destroying and recreating them)
4. Svelte reactivity re-renders affected blocks
5. Restore focus to the block and offset stored in the entry

### Redo Behavior

Same flow, opposite direction. The redo stack is cleared whenever a new edit occurs after an undo (standard redo semantics).

### Relationship to Persistent History

The undo stack is session-scoped — lives in memory, cleared when the document is closed. Persistent version history (Automerge) operates at the save boundary. When the document saves, the current CST state is serialized and written through the persistence layer.

```
Ctrl+Z / Ctrl+Y  →  Undo stack (CST snapshots, in memory, session-scoped)
Version history   →  Automerge (persistent, cross-session, operates on save)
```

The two systems do not interact. The editor produces a serialized document on save; the storage layer handles Automerge. This boundary allows both systems to be developed independently.

## Block Identity

CST nodes need stable IDs for two reasons:

1. **Svelte's keyed `{#each}`**: Without stable keys, structural operations (split, merge) cause Svelte to destroy and recreate DOM nodes, losing contenteditable state (cursor position, composition state).
2. **Focus management after structural operations**: The editor needs to target a specific block for focus between the CST mutation and the post-`tick()` focus call.

### Approach

Assign a unique string ID to each block at parse time. IDs are an editor-level concern — the editor shell maintains a parallel `string[]` array of IDs aligned with the document's children array. This array is the `{#each}` key source: `{#each children as child, i (blockIds[i])}`. IDs are not stored on the CST nodes themselves.

The ID array is updated atomically with every children array mutation:

- **Split**: Insert a new ID at `index + 1`. The original ID stays at `index`.
- **Merge**: Remove the ID at the absorbed block's index.
- **Delete**: Remove the ID at the deleted block's index.
- **Reorder**: Move the ID to match the new position.
- **Re-parse** (block type change): The ID at that index does not change — only the node object is swapped.

## Node Type Coverage

The CST defines 14 node types. The editor must handle all of them. Node types not yet assigned a dedicated component render as **raw-editable blocks** — the `raw` text is shown in a contenteditable with monospace styling, fully editable, with no special merge behavior.

| Node Type               | Kind                      | Editor Behavior                                                                                                                                                                                                                         |
| ----------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                | `document`                | Root — not rendered as a block                                                                                                                                                                                                          |
| Paragraph               | `paragraph`               | Primary text block, contenteditable                                                                                                                                                                                                     |
| Heading                 | `heading`                 | Styled heading, contenteditable                                                                                                                                                                                                         |
| SetextHeading           | `setextHeading`           | Treated identically to Heading for editing purposes. The editor may normalize setext headings to ATX headings during editing (replacing the underline form with `##` form) since the user is editing styled source, not raw text layout |
| FencedCode              | `fencedCode`              | Code editing surface (contenteditable, textarea, or CodeMirror)                                                                                                                                                                         |
| ThematicBreak           | `thematicBreak`           | Non-editable, focusable                                                                                                                                                                                                                 |
| IndentedCode            | `indentedCode`            | Raw-editable block (until dedicated component built). Merge: not mergeable                                                                                                                                                              |
| HtmlBlock               | `htmlBlock`               | Raw-editable block. Merge: not mergeable                                                                                                                                                                                                |
| LinkReferenceDefinition | `linkReferenceDefinition` | Raw-editable block. Note: editing a link reference definition may affect reference-style links throughout the document — document-wide re-render may be needed when a definition's label changes. Merge: not mergeable                  |
| Table                   | `table`                   | Grid editor (future). Raw-editable until then. Merge: not mergeable                                                                                                                                                                     |
| UnrecognizedBlock       | `unrecognized`            | Raw-editable block. This is the catch-all for any syntax the parser doesn't recognize. Merge: two adjacent unrecognized blocks are mergeable (concatenate raw). Split: produces two unrecognized blocks                                 |
| Blockquote              | `blockquote`              | Container — recursive BlockList (see Container Blocks section)                                                                                                                                                                          |
| List                    | `list`                    | Container — renders ListItem children                                                                                                                                                                                                   |
| ListItem                | `listItem`                | Container — recursive BlockList for inner content                                                                                                                                                                                       |

## Lessons from Previous Failures

These are guardrails for implementation, derived from a previous failed attempt at a per-block editor.

### 1. If you need a timing hack, the design is wrong

`setTimeout`, `queueMicrotask`, and `requestAnimationFrame` for sequencing are symptoms, not solutions. The only acceptable async timing in this editor is `await tick()` for post-render focus management. Anything else means the operation flow needs rethinking.

### 2. No monkey-patching

Every dependency is explicit — constructor parameters, Svelte context, or component props. No runtime method assignment. In Pillar, `block.save`, `block.delete`, and `orchestrator.addNewBlock` were assigned at runtime, making dependencies implicit and debugging difficult.

### 3. The CST is the single source of truth

If the CST and the DOM disagree, the CST wins. If the CST and the undo stack disagree, the undo stack's snapshot replaces the CST. There is never a question of "which state is correct."

### 4. Adding a block type should be boring

Write a component, register it, done. If adding a new block type requires touching the editor shell, the orchestration logic, or the selection system, the architecture has a coupling problem.

### 5. Don't build upward on a shaky foundation

Pillar collapsed because it built upward on a shaky foundation. A paragraph-only editor that handles split/merge/focus/undo flawlessly is more valuable than a full-featured editor where nothing quite works.
