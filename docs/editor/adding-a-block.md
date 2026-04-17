# Adding a New Block Type

How to add a block type to the CST editor. See `docs/design/editor/editor.md` for the architecture.

## Where Blocks Live

Block components live in `src/lib/editor/components/blocks/`. Orchestration components (Editor, BlockList, BlockHost) stay in `src/lib/editor/components/`. Pure container state and focus helpers live in `src/lib/editor/container-state/`. Pure contenteditable DOM helpers live in `src/lib/editor/contenteditable/`.

## Two Categories

| Category | Editing surface | Reference |
|----------|----------------|-----------|
| **Leaf** | Own editing surface (contenteditable, textarea, static) | TextEditableBlock, CodeBlock, ThematicBreakBlock |
| **Container** | Hosts a recursive BlockList of child blocks | BlockquoteBlock, ListBlock, ListItemBlock |

Pick the reference closest to your block. Read it fully before starting.

## BlockComponent Interface

Every block exposes the `BlockComponent` shape — two boolean flags (`editable`, `focusable`) plus focus and cursor methods. Optional extensions cover selection and path-based focus cascade for containers. A `satisfies BlockComponent` assertion at the bottom of the script enforces the shape at compile time.

## Reading Parent Contexts

Leaf and container blocks alike read from the concern-specific sub-interface contexts:

- `BLOCK_EDIT_KEY` → `BlockEditActions` — structural mutations (split, merge, delete, updateContent, replaceBlock, insertParsedBlocks)
- `FOCUS_KEY` → `FocusActions` — moveFocus (with sticky-column variant)
- `HISTORY_KEY` → `HistoryActions` — requestUndo / requestRedo
- `CONTAINER_EDIT_KEY` → `ContainerEditActions` — container-edit bracketing (begin / beginDebounced / end)

A block reads only the sub-interfaces it actually uses. Containers set only the sub-interfaces they override for their nested children; Svelte context walking delivers everything else from the nearest ancestor that does set it.

## Registration

Add a case to `BlockHost`'s `{#if}` chain. The block receives `node`, `index`, and binds `ref`.

## Container Blocks

Containers build their reactive state and default action bundle through the `container-state/` primitives, then override only the methods that need kind-specific behavior.

- `createBlockListState(node)` — reactive `innerBlockIds` / `innerBlockRefs` plus a `commitChildrenEdit` helper for atomic triple-splice operations on children, ids, and refs.
- `createStandardNestedActions(state, deps)` — generates a complete `{ blockEdit, focus, containerEdit }` bundle from the state bundle plus a `rebuildRaw` callback. Methods in the bundle handle the split/merge/delete/updateContent/replaceBlock ceremony uniformly; containers override specific methods (e.g., blockquote U2, list U1/M1, list-item Enter behavior) by capturing the factory method and chaining.
- `dispatchFocusByPath` / `dispatchFocusAtColumn` — the pure dispatchers a container's `focusByPath` / `focusAtColumn` exports delegate to.
- `setNestedActionsContexts(bundle)` — the three-setContext helper that publishes the bundle to nested descendants.

A trivial container (future admonition block, collapsible section, etc.) calls the factory, sets contexts, and is done. A non-trivial container (list, blockquote) calls the factory and then overrides the specific methods that carry kind-specific behavior — always by capturing the factory method first and chaining to it for the non-custom branches, so the default merge-eligibility and commit logic isn't reinvented.

Containers don't set `HISTORY_KEY` — undo/redo walks up to the editor root directly.

Containers rebuild their `raw` from their inner children after every structural mutation. The `rebuildRaw` callback passed to `createStandardNestedActions` is the kind-specific rebuild helper (`rebuildBlockquoteRaw`, `rebuildListRaw`, etc.).

## Sticky column participation

Every editable block (prose or code) participates in the pixel-X sticky column system. When adding a new block type with its own editing surface:

1. **Capture on vertical arrows.** In `onKeyDown`, when the key is `ArrowUp` or `ArrowDown`, call `stickyColumn.capture(getCurrentCursorEditorRelativeX(el))`. The capture is idempotent — it only records if sticky is currently null.
2. **Reset on non-preserve keys.** In the same handler, for any key not in `PRESERVE_KEYS_NON_ARROW` and not a vertical arrow, call `stickyColumn.reset()`. Also reset on `onPointerDown`, `onCompositionStart`, `onCopy`, `onCut`, and `onPaste`.
3. **Implement `focusAtColumn`.** Expose a `focusAtColumn(x, from)` method that uses `findOffsetNearestX(el, x, from)` from `contenteditable/sticky-measure.ts` to position the cursor at the nearest offset on the first (`from === 'above'`) or last (`from === 'below'`) visual line.

`TextEditableBlock.svelte` and `CodeBlock.svelte` share the same implementation shape — reference either one.

## Adding a code-block language

To register a new code-block language for syntax highlighting, edit `src/lib/editor/code-surface/code-bootstrap.ts`:

1. `import <name> from 'highlight.js/lib/languages/<name>';` at the top.
2. Call `registerLanguage('<name>', <name>, ['alias1', 'alias2']);` inside `bootstrapCodeLanguages()`.

No other file needs to change. The new language is available immediately on the next editor mount.

## Testing

Complex blocks (lists, tables) get a dedicated spec in `src/lib/editor/e2e/requirements/blocks/` and test file in `src/lib/editor/e2e/tests/blocks/`. Simple blocks are covered by the feature-level test suites.

Write the requirements first, then the tests, then the implementation.
