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
Editor (shell — owns CST, undo stack, editor-actions contexts)
  └─ BlockList (keyed {#each} over CST children)
       ├─ BlockHost (resolves component by node.kind)
       │    ├─ TextEditableBlock (paragraph, heading, setextHeading, raw-editable)
       │    ├─ CodeBlock (fenced code — textarea surface)
       │    ├─ ThematicBreakBlock (non-editable, focusable)
       │    ├─ BlockquoteBlock (container — nested BlockList)
       │    └─ ListBlock (container — ListItemBlock children, each with nested BlockList)
       └─ ...
```

- **Editor** — top-level shell. Owns the CST `Document`, the undo stack, and the editor-actions contexts. Manages focus after structural operations using `await tick()`.
- **BlockList** — renders the CST children array via a keyed `{#each}`.
- **BlockHost** — given a CST node, resolves which block component to render by `node.kind`. Thin wrapper.
- **TextEditableBlock** — shared contenteditable surface for paragraphs, headings, and raw-editable block types, parameterized by CSS class.
- **Container block components** — `BlockquoteBlock` and `ListBlock`/`ListItemBlock` each host a nested `BlockList` with their own scoped editor-actions contexts.

### Data Flow

```
Block detects boundary event (Enter, Backspace at pos 0, arrow at edge)
  → Calls editor-actions context function
  → Editor shell mutates the CST document tree
  → Svelte reactivity re-renders affected blocks
  → Editor calls focus() on the target block after await tick()
```

Four communication channels:

| Direction      | Mechanism                                         | What Flows                                        |
| -------------- | ------------------------------------------------- | ------------------------------------------------- |
| Block → Editor | Context callbacks (editor-actions sub-interfaces) | Boundary events: split, merge, delete, move focus |
| Editor → CST   | Direct tree mutation                              | Structural changes to the document tree           |
| CST → Blocks   | Svelte reactivity                                 | Blocks re-render from new tree state              |
| Editor → Block | Component refs (`bind:this`)                      | `focus(offset)` for focus management              |

## The Editing Surface

### Per-Block Architecture

The document renders as a vertical stack of block components, one per CST node. Each block is an independent editing unit that chooses its own internal editing surface:

- Text blocks (paragraphs, headings) use `contenteditable`
- Code blocks could use `contenteditable`, a `<textarea>`, or an embedded CodeMirror
- Tables could use a grid of inputs/cells
- Non-editable blocks (thematic breaks, images) render as static elements with focus support

Not all blocks require `contenteditable`. A block only needs to conform to the common interface.

### Block Interface

Every block component exposes a common shape. Two boolean flags — `editable` (can receive text input) and `focusable` (can receive focus at all) — let the orchestration layer decide what interactions are valid. Optional methods cover focus management (`focus` with an offset, `getCursorOffset`) and selection (`getSelectedText`, `setSelection` with start/end offsets). Not every block implements every method; non-text blocks omit the selection and cursor methods.

Examples:

- `TextEditableBlock` (paragraph, heading, raw): `{ editable: true, focusable: true }` — contenteditable, parameterized by CSS class
- `CodeBlock`: `{ editable: true, focusable: true }` — contenteditable editing surface with live syntax highlighting
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

This rendering mode maps to the CST phases:

- **Phase 1 (raw source)**: Block-level styling only — headings are large, code blocks have a monospace background
- **Phase 2 (inline parsing)**: Inline syntax gets styled — bold text is bold even with visible `**`. This is the permanent architecture — Phase 3 was evaluated and rejected (see `docs/design/editor/syntax-tree.md`)

## CST Mutability

The CST uses mutable plain objects — no class hierarchy, no `readonly` fields on CST nodes. The parser produces mutable `CstNode` objects directly. The editor mutates them in place during editing (updating `raw`, replacing children, etc.). There is no immutable→mutable conversion step.

This means:

- `parse(source)` produces a mutable `Document` with `CstNode` children
- The editor works with these nodes directly — no wrapping or cloning on load
- Edits mutate nodes in place
- Single-block re-parse uses `parse()` on the block's `raw` text, then transfers the result into the existing tree
- Undo takes deep CST snapshots before mutations
- `serialize()` reads `raw` fields only — structurally typed, works on any object with the right shape

## CST ↔ DOM Synchronization

The CST is the document-level source of truth. Within a single block during active editing, the DOM leads and the CST follows.

### Normal Text Input

User types → browser updates DOM → `input` event reads `textContent` → CST `raw` updated → single-block re-parse refreshes metadata and inline content → if the block's kind changed, re-render with the new component type.

The common case (no kind change) requires no DOM patching — the browser's update and the CST agree. Prose blocks rebuild their styled span tree from `inlineContent` on every input; cursor offsets map to `raw` positions unchanged.

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

Blocks call typed context functions for structural operations: split, merge, delete, move focus, update content, undo, redo. Each takes a block index relative to the local children array. Structural operations use `await tick()` for post-render focus management.

Block–editor communication is divided across four focused sub-interfaces (block editing, focus, history, and container editing), each provided via its own Svelte context key. Containers set only the sub-interfaces they override; history and non-overridden concerns are resolved by walking up the Svelte context tree to the nearest ancestor that provides them. Pass-through delegation boilerplate is eliminated.

No signal dispatcher, no string matching, no performer registry. Blocks call typed functions directly.

### Downward Communication (Editor → Block)

The editor only needs to reach down to blocks for focus management. This uses component refs (`bind:this`). After a structural CST mutation and `await tick()`, the editor calls `blockRefs[targetIndex].focus(offset)`.

### Structural Operations

All structural operations are CST tree mutations performed by the editor shell. Blocks never modify the tree structure.

**Split** — cut `raw` at the cursor offset, produce two nodes, re-parse each to determine type. The original keeps its ID; the new block gets a fresh ID. Offsets are relative to `raw` including markers — block components translate DOM positions to raw offsets. The marker is not duplicated; the second half re-parses as its natural type.

**Merge** — take two adjacent CST nodes, concatenate their `raw` text, replace both with one node, re-parse to determine the merged block's type. The surviving block keeps its ID.

Merge eligibility is derived from per-kind **merge roles** rather than an enumerated pair set. Each block kind is assigned one of five roles:

- `prose` — leaf text block (paragraph)
- `prose-absorber` — prose leaf that keeps its kind when absorbing prose (heading, setextHeading)
- `container` — block whose merge target is its deepest reachable prose leaf (blockquote, list, listItem)
- `self-merge` — merges only with another block of the same role (unrecognized)
- `opaque` — not mergeable; Backspace either deletes (if non-editable) or moves focus (fencedCode, indentedCode, htmlBlock, linkReferenceDefinition, table, thematicBreak)

The role-pair switch for eligibility:

- `prose + prose` → eligible, concatenate text
- `prose-absorber + prose` → eligible, target keeps its kind and absorbs text
- `container + prose` → eligible, walk into the container's subtree to find the deepest prose leaf (generalizes M1's "deepest visible text above" rule across container boundaries)
- `self-merge + self-merge` → eligible, concatenate raw
- everything else → not eligible

When `container + prose` is eligible but the walker cannot find a prose leaf (the container's deepest leaf is opaque, or the container is empty), the caller falls back to the same behavior as an ineligible pair: move focus to the end of the deepest reachable block.

When merge is not eligible, Backspace at the start of a block has three possible outcomes depending on context:

- **Previous block is non-editable**: delete the previous block
- **Current block is the first child of a container (blockquote, list)**: unwrap the container — see "Container Unwrap" below
- **Otherwise**: move focus to the end of the previous block (if editable)

### Container Unwrap

Backspace at offset 0 of a container's first child triggers an unwrap operation:

- **Blockquote (Rule U2)**: the first child is lifted out of the blockquote into the parent at the blockquote's position. If the blockquote becomes empty, it is deleted. Each press lifts exactly one structural level.
- **List, non-empty first item (Rule U1)**: the item's first paragraph becomes a plain paragraph before the list. Matching-type nested sub-list items promote to the shrunk parent list level; mismatched-type sub-lists become separate blocks. If removing the first item empties the list, the list is deleted.
- **List, non-empty non-first item (Rule M1)**: the item merges into the "deepest visible text above" via rule B; remaining children are placed by preserve-absolute-indent. Ordered markers renumber.
- **List, nested first item (any list that has a parent list)**: the item is promoted to the parent list level (Shift+Tab equivalent).

No auto-merge with the block above the container occurs — each Backspace press performs exactly one operation.

**Delete** — remove the node from the children array.

**Reorder** — move the node within the children array. IDs don't change.

**Block type change** (via re-parse) — when re-parsing a block's updated `raw` produces a different block kind, the node is replaced with a new node of the correct type. The ID is preserved.

### Focus Traversal

Arrow key navigation at block boundaries uses geometry-based visual-line detection (cursor rect compared against the first/last line's rect inside the block):

- **ArrowUp** at the top visual line, or **ArrowLeft** at offset 0: move focus into the previous block.
- **ArrowDown** at the bottom visual line, or **ArrowRight** at end of content: move focus into the next block.
- Vertical arrows additionally carry sticky column state — see the Sticky column subsection below.
- `moveFocus` skips non-focusable blocks. Thematic breaks receive a whole-block focus highlight.
- `focus(offset)` on non-editable blocks ignores the offset. Enter creates a new paragraph below; Backspace deletes the block.

#### Sticky column

Cross-block caret column memory. Vertical arrow presses capture the cursor's editor-relative pixel X and preserve it across multiple presses, so navigating through short intermediate lines doesn't lose the user's original column intent. Within a single block the browser's native sticky column handles movement; we layer on top only at block boundaries where the native sticky resets.

**Key rules:**

- **Capture**: idempotent on the first vertical arrow press after a reset. The captured value is editor-relative (scroll-invariant).
- **Reset**: any user action other than plain or shifted vertical arrows — typing, click, horizontal arrows, structural ops, undo/redo, editor blur, tab hidden.
- **Transparent blocks** (thematic break): pass through without capturing or resetting; the next cross-block move continues with the existing value.
- **Participating blocks** (text-editable blocks, code blocks): capture sticky X on vertical arrow presses and implement `focusAtColumn(x, from)`. The only difference between prose and code blocks is the rendered content — both share the `contenteditable/` helpers and the same capture/reset policy.

> **"Opaque" disambiguation.** The term "opaque" also appears in `merge-rules.ts` to mean "not mergeable via Backspace." That is a completely separate concept from sticky-column behavior. A block can be `MergeRole.opaque` (like `fencedCode`) and still be a participating sticky-column block. Do not conflate the two.

Each editor instance owns its own sticky column state, provided to block components via Svelte context. Cross-block vertical moves carry a "from above / from below" direction through the focus-dispatch chain; target blocks that support pixel-column positioning use it to land the cursor at the nearest column on the appropriate visual line. Blocks that don't participate fall back to start-of-block or end-of-block focus.

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
- Each nested `BlockList` provides its own editor-actions contexts scoped to that nesting level
- Boundary events from inner blocks bubble up through nesting levels

This aligns with the principle that "adding a block type is an additive operation." A `BlockquoteBlock` is just another block component — it happens to contain a recursive `BlockList` inside it.

### Addressing

Context functions use `blockIndex` relative to the **local** children array at each nesting level. When a `ParagraphBlock` inside a blockquote calls `splitBlock(1, offset)`, it operates on index 1 of the blockquote's inner children, not the document's top-level children.

The nested `BlockList` inside a container block provides its own scoped editor-actions contexts. It handles local operations (split, merge, focus traversal within the container) directly, and delegates to the parent context for operations that cross the container boundary (e.g., Backspace at the start of the first child should merge with or exit the container).

### Focus Traversal Through Containers

- **ArrowDown** from the last line of a block inside a container: first try to move to the next sibling within the container. If at the last sibling, the inner `BlockList` signals upward to the container, which signals to the parent `BlockList` to move focus to the next block after the container.
- **ArrowUp** from the first line of the first child: the inner `BlockList` signals upward, and focus moves to the block before the container in the parent `BlockList`.
- **Entering a container**: when focus moves to a container block from the outside (ArrowDown into a blockquote), focus goes to the first (or last, depending on direction) editable child inside it.

### Container-Specific Operations

- **Splitting inside a container**: splits the inner child, not the container. The container's `raw` is reconstructed from its children.
- **Deleting all children of a container**: removes the entire container from the parent.
- **Backspace at start of first child**: unwraps (see "Container Unwrap" above). Rules U1 / U2 / M1 cover list first-item, blockquote first-child, and list non-first item respectively.
- **Enter in a list item**: Creates a new sibling list item. Enter at the end of a list item's content inserts a new item below; Enter in the middle splits the content across two items. Enter in an empty list item exits the list — matching-type nested sub-list items promote into the surviving list, while mismatched-type nested lists and any non-list trailing children lift out as top-level siblings rather than being dropped. Ordered markers renumber across the exit gap.

### Impact on Block Identity and Selection

Block identity (`blockIds`) is maintained per `BlockList` — each nesting level has its own ID array. Cross-block selection within a container uses the same `EditorSelection` model scoped to that container's `BlockList`. Cross-container selection (selecting from inside a blockquote to outside it) requires the cross-block selection system.

## Selection

### Single-Block Selection

Native browser selection within the block's contenteditable. The native caret is hidden via CSS; focus stays on the focused block's contenteditable. Copy/cut are intercepted (see Clipboard section) but selection highlighting is native.

### Cross-Block Selection Model

The selection model tracks two endpoints — anchor and focus — each identified by a `path: number[]` (child indices from document root to leaf block) and a character offset within that block's `raw`. When both endpoints share the same path, it is a single-block selection and the browser handles it natively. When the paths differ, the editor manages all selection rendering.

The selection state is lazy: fields are null in single-block mode and become non-null only when the selection crosses block boundaries. A `start`/`end` normalized pair (document order) is derived from anchor/focus.

### Entering Cross-Block Selection

- **Pointer drag**: drag within block A starts native selection; when the pointer crosses into block B, the editor captures the anchor position, clears native selection, and switches to custom rendering. Updates are rAF-throttled with autoscroll at viewport edges.
- **Shift+Arrow**: Shift+ArrowDown from the end of a block (or Shift+ArrowUp from the start) extends into the neighboring block. Ctrl+Shift+Home/End extends to document boundaries.
- **Shift+click**: click in a different block from the anchor extends the selection to that point.
- **Double Ctrl+A**: first press selects all text within the focused block (native); second press selects the entire document (cross-block, anchor at start of first block, focus at end of last block).

### Cross-Block Selection Rendering

Each `BlockHost` wraps its content in a `.block-host` div and mounts a `SelectionOverlay` component. The overlay classifies its block as start, end, middle, or outside the selection range and renders accordingly:

- **Endpoint blocks** (first and last): partial rects measured via an optional `measurePartialRects` method on the block component, producing positioned highlight overlays that handle text wrapping across visual lines.
- **Middle blocks**: a CSS overlay covering the entire block element.
- **Non-text blocks** in the range: full-block highlight overlay.

#### `measurePartialRects` contract by surface type

The hook's `(startOffset, endOffset)` shape is stable but its offset semantics depend on the block's surface. New block kinds with their own surfaces must pick one:

- **Text contenteditable surfaces** (paragraph, heading, code block). Offset is a character index into `textContent`. The shared helper `measurePartialRectsInContentEditable` walks the DOM to produce wrapping-aware rects. Every contenteditable block reuses it — no per-block work.
- **Cell-based surfaces** (tables, and anything with 2D grid layout). Offset is a cell index in row-major order. `measurePartialRects(start, end)` returns one rect per cell in `[start, end)`. Selection start/end offsets coming from the cross-block selection state must be cell indices under this convention — the surface is responsible for mapping click/drag positions to cell indices on entry.
- **Opaque single-unit surfaces** (image block, thematic break, future embeds). Only offsets 0 and 1 are valid — 0 is "before the unit" and 1 is "after". Any non-empty range returns the surface's bounding rect as a single-element array. Callers that want finer granularity should use a different block kind.

A block that doesn't implement `measurePartialRects` falls back to the full-block overlay — the SelectionOverlay covers the block's `.block-host` bounds. This is acceptable for middle blocks but loses the "selection ends mid-line" visual for endpoints. New endpoint-capable block kinds should implement one of the above contracts.

### Exiting Cross-Block Selection

Click (collapsing the selection) or an unshifted arrow key clears cross-block state and returns to native single-block selection. Typing, Backspace, Delete, Cut, and Paste all collapse and exit after their respective operations.

### Cross-Container Semantics

When a selection spans container boundaries (e.g. from inside a blockquote to a top-level paragraph), the "start wins" rule applies: the start endpoint's container context determines the merge/cleanup behavior after a destructive operation.

## Clipboard

Clipboard content is always plain markdown text, sourced from the CST. No HTML clipboard format, no browser-default copy behavior. All clipboard operations are intercepted in every context (single-block and cross-block).

### Copy (Ctrl+C)

**Single-block**: slice the focused block's `raw` at the selection offsets and write to clipboard.

**Cross-block**: walk the selection range from anchor to focus, collecting the tail of the anchor block, full raw (with leading trivia) of middle blocks, and the head of the focus block. Concatenate and write to clipboard. The selection stays active after copy.

### Cut (Ctrl+X)

Copy the selected range, then delete it. For cross-block: truncate the anchor and focus blocks at their respective offsets, remove fully-selected middle blocks, merge the remaining endpoints into one block (re-parsed to determine block type), and clean up empty containers. Push an undo entry; cross-block state collapses.

### Paste (Ctrl+V)

Always intercepted. If there is a selection (single or cross-block), delete the selected range first. Parse the pasted text through the CST parser. If the result is a single paragraph, insert the text at the cursor position. Anything else (multiple blocks, or a single non-paragraph block like a list, heading, code block, or blockquote) takes the structural path: split the current block at the cursor, splice in the parsed blocks as their own structural children with blank-line separators, and place the post-cursor remainder as a trailing paragraph. The full delete-then-paste collapses into a single undo entry; focus restores at the end of the pasted content.

### Delete / Backspace / Type-Replace

When a cross-block selection is active, Backspace, Delete, and typing all delete the selected range first (same path as Cut without the clipboard write), then perform their normal single-block action at the collapsed cursor. IME composition events follow the same delete-then-compose path.

## Undo/Redo

### Model

Single unified undo stack; browser contenteditable undo is disabled. Each entry captures a full CST document snapshot, the block ID array (for stable keyed rendering), and a uniform `selection` field (an anchor/focus pair using path-based addressing) for cursor and selection restoration. Collapsed, single-block, and cross-block selections all use the same representation. Entries are cloned CST trees — cheap to snapshot. The stack is capped to prevent unbounded growth.

### Snapshot Triggers

- Before every structural operation (split, merge, delete, reorder)
- Before every clipboard operation (cut, paste)
- Text input is batched: consecutive keystrokes in the same block group into one entry, broken by pauses, focus changes, or structural operations

### Behavior

Undo restores the previous snapshot, pushes the current state onto the redo stack, and restores the saved selection (including cross-block state if the original operation had one). Redo is the inverse. The redo stack clears on any new edit.

### Commit Primitive

Every structural mutation routes through a single internal commit helper. Two public entry points cover the two scopes:

- **Top-level scope** — operations on the document's children array (split, merge, delete, paste, replaceBlock, kind-change republish).
- **Container scope** — operations confined to a single container's children array (nested split/merge/delete, nested paste, list item reorder inside one list).

Both entry points delegate to one internal `__commit` that owns the full ceremony: capture pre-mutation snapshot, run the mutation on plain-array copies, publish the new children atomically, emit an `edit` event, record an op-log entry, and `await tick()` before running any caller-supplied post-tick callback (focus landing, cursor placement). Callers pick their scope; they don't assemble the ceremony themselves. This retires an older pattern where container mutations were bracketed by begin/end calls and a separate reactivity nudge — the commit primitive is now the only seam.

### Event Seam

The editor exposes an observer-pattern event surface at `editor.events`. Two channels:

- **`edit`** — fires after every commit, with a discriminated union keyed by `op`: structural ops (split / merge / delete / paste / replaceBlock / updateContent) emitted by the commit primitive, plus `input` emitted by the debounced keystroke flush, plus `undo` / `redo` emitted by the history layer.
- **`selectionChange`** — fires whenever the selection state changes. Payload is the selection snapshot or `null`.

Events fire synchronously from their emission sites. Handlers must not mutate the document; reentrant edits are not supported. Subscribe via `on(name, cb)`, which returns a disposer.

The debug op-log is implemented as a subscriber to the `edit` channel, not as a direct call from commit sites. Future persistent-history layers and external observers hook in the same way without touching editor internals.

The nested paste path emits `op: 'replaceBlock'` because `insertParsedBlocks` delegates to `replaceBlock` on the container. Top-level paste emits `op: 'paste'`. Consumers that count paste events across paths should match on both variants.

### Relationship to Persistent History

The undo stack is session-scoped — it lives in memory and clears when the document is closed. A future persistent version history layer is expected to operate at a different boundary (the save write), and the two systems are designed not to interact: the editor produces a serialized document on save, and whatever storage layer handles cross-session history does so independently.

The persistent-history mechanism itself — Automerge, Yjs, a custom CRDT, or a simpler linear log — is a roadmap decision that has not been made. Treat the section below as a working assumption about _shape_, not _technology_.

```
Ctrl+Z / Ctrl+Y  →  Undo stack (CST snapshots, in memory, session-scoped)
Version history   →  TBD persistence layer (cross-session, operates on save)
```

This boundary allows the in-memory undo work and the durable history work to be developed independently.

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

The CST defines one document root plus 13 block kinds the editor must handle. Block kinds not yet assigned a dedicated component render as **raw-editable blocks** — the `raw` text is shown in a contenteditable with monospace styling, fully editable, with no special merge behavior. The `document` row below is included for completeness but is the tree root, not a rendered block.

| Node Type               | Kind                      | Editor Behavior                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Document                | `document`                | Root — not rendered as a block                                                                                                                                                                                                                   |
| Paragraph               | `paragraph`               | Primary text block, contenteditable                                                                                                                                                                                                              |
| Heading                 | `heading`                 | Styled heading, contenteditable                                                                                                                                                                                                                  |
| SetextHeading           | `setextHeading`           | Treated identically to Heading for editing purposes. The editor may normalize setext headings to ATX headings during editing (replacing the underline form with `##` form) since the user is editing styled source, not raw text layout          |
| FencedCode              | `fencedCode`              | Code editing surface (contenteditable with live `.code-tok-*` span rendering via `components/blocks/code/` + highlight.js). Participating sticky-column block. Fences rendered as dimmed `.md-marker` spans; info string styled with `.md-lang`. |
| ThematicBreak           | `thematicBreak`           | Non-editable, focusable                                                                                                                                                                                                                          |
| IndentedCode            | `indentedCode`            | Raw-editable block (until dedicated component built). Merge: not mergeable                                                                                                                                                                       |
| HtmlBlock               | `htmlBlock`               | Raw-editable block. Merge: not mergeable                                                                                                                                                                                                         |
| LinkReferenceDefinition | `linkReferenceDefinition` | Raw-editable block. Note: editing a link reference definition may affect reference-style links throughout the document — document-wide re-render may be needed when a definition's label changes. Merge: not mergeable                           |
| Table                   | `table`                   | Grid editor (future). Raw-editable until then. Merge: not mergeable                                                                                                                                                                              |
| UnrecognizedBlock       | `unrecognized`            | Raw-editable block. This is the catch-all for any syntax the parser doesn't recognize. Merge: two adjacent unrecognized blocks are mergeable (concatenate raw). Split: produces two unrecognized blocks                                          |
| Blockquote              | `blockquote`              | Container — recursive BlockList (see Container Blocks section)                                                                                                                                                                                   |
| List                    | `list`                    | Container — renders ListItem children                                                                                                                                                                                                            |
| ListItem                | `listItem`                | Container — recursive BlockList for inner content                                                                                                                                                                                                |

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
