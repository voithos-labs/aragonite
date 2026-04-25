# Adding a New Block Type

How to add a block type to the CST editor. See `docs/design/editor/editor.md` for the architecture.

## Where Blocks Live

Block components live in `src/lib/editor/components/blocks/`. Orchestration components (Editor, BlockList, BlockHost) stay in `src/lib/editor/components/`. Editor action bundles and the container helpers they compose (nested-actions, list-context, blockquote-context, focus-dispatch) live in `src/lib/editor/editor-actions/`; the shared reactive state bundle (`block-list-state`) and its `state-registry` sit at the editor root. Block-kind and block-component registries live in `src/lib/editor/schema/`. Pure DOM helpers split by concern: `src/lib/editor/ambient/` for ambient-prefix offset and rendering helpers, `src/lib/editor/cursor/` for cursor, sticky-column, and overlay measurement helpers.

## Two Categories

| Category      | Editing surface                                         | Reference                                        |
| ------------- | ------------------------------------------------------- | ------------------------------------------------ |
| **Leaf**      | Own editing surface (contenteditable, textarea, static) | TextEditableBlock, CodeBlock, ThematicBreakBlock |
| **Container** | Hosts a recursive BlockList of child blocks             | BlockquoteBlock, ListBlock, ListItemBlock        |

Pick the reference closest to your block. Read it fully before starting.

## BlockComponent Interface

Every block exposes the `BlockComponent` shape — two boolean flags (`editable`, `focusable`) plus focus and cursor methods. Optional extensions cover selection and path-based focus cascade for containers. A `satisfies BlockComponent` assertion at the bottom of the script enforces the shape at compile time.

## Reading Parent Contexts

Leaf and container blocks alike read from the concern-specific sub-interface contexts:

- `BLOCK_EDIT_KEY` → `BlockEditActions` — structural mutations (split, merge, delete, updateContent, updateBlockMetadata, replaceBlock, insertParsedBlocks)
- `FOCUS_KEY` → `FocusActions` — moveFocus (with sticky-column variant)
- `HISTORY_KEY` → `HistoryActions` — requestUndo / requestRedo
- `CONTROLLER_KEY` → multi-scope commit primitive, used by container components that participate in cross-container operations
- `CONTAINER_EDIT_KEY` → `ContainerEditActions` — structural `commitContainer` (preferred) plus three out-of-primitive seams: `pushCheckpoint` / `pushDebouncedCheckpoint` bracket raw mutations that happen outside the commit primitive, `nudgeReactivity` publishes those raw changes up to Svelte. Prefer `commitContainer` here (or `commitMultiScope` via `CONTROLLER_KEY`) unless the caller has reason to mutate raw itself (IME composition, cross-block typing, drag/clipboard sync mutate).

A block reads only the sub-interfaces it actually uses. Containers set only the sub-interfaces they override for their nested children; Svelte context walking delivers everything else from the nearest ancestor that does set it.

## Registration

Two registration steps per new block kind:

1. **Descriptor** — call `registerBlockKind(kind, { mergeRole, editable, isContainer, supportsInline, getContentRange?, rebuildRaw? })` in `schema/block-kind-descriptor.ts`. `supportsInline` marks prose kinds that carry an inline tree; `getContentRange` returns the content offset range within `raw` for the inline parser; `rebuildRaw` is required for container kinds and is patched in from `schema/container-raw.ts` via `augmentBlockKind`.
2. **Component** — call `registerBlockComponent(kind, { component, extraProps? })` in `schema/block-components.ts`. `extraProps` returns any per-node props beyond the standard `{ node, index, myPath, ambientPrefix, ref }` set (e.g. TextEditableBlock's `blockClass`). BlockHost looks up by kind via the registry.

Consumers (merge-rules, BlockHost, SelectionOverlay, paste-dispatch, inline pipeline, container-raw dispatch) read from these two registries rather than each maintaining their own per-kind list.

## Container Blocks

Containers build their reactive state and default action bundle through the `editor-actions/` primitives, then override only the methods that need kind-specific behavior.

- `createBlockListState(node)` — reactive `innerBlockIds` / `innerBlockRefs`. Structural mutations on the container's children go through the commit primitives on the editor's `UndoController` (`commitContainer` via the `ContainerEditActions` context, or `commitMultiScope` via `CONTROLLER_KEY` for cross-container ops) — both apply `StructuralChange` descriptors to keep ids/refs aligned with children.
- `createStandardNestedActions(state, deps, overrideFactory?)` — generates a complete `{ blockEdit, focus, containerEdit }` bundle from the state bundle plus a `rebuildRaw` callback. Methods in the bundle handle the split/merge/delete/updateContent/replaceBlock ceremony uniformly; containers with kind-specific behavior pass an optional `overrideFactory` as the third argument. The factory receives the fully-built default bundle and returns per-sub-interface partial overrides; overrides chain to the default by calling `defaults.blockEdit.splitBlock(...)` etc. directly.
- `dispatchFocusByPath` / `dispatchFocusAtColumn` — the pure dispatchers a container's `focusByPath` / `focusAtColumn` exports delegate to.
- `setNestedActionsContexts(bundle)` — the three-setContext helper that publishes the bundle to nested descendants.

A trivial container (future admonition block, collapsible section, etc.) calls `createStandardNestedActions(state, deps)` with no overrides and is done. A non-trivial container (list, blockquote) passes an `overrideFactory` that returns only the methods it customizes — see the blockquote and list context files under `editor-actions/` for canonical extracted examples. The override set is visible at the call site, type-checked against each sub-interface, and stable references to the defaults are captured in a closure the overrides control — no post-construction method reassignment.

Containers don't set `HISTORY_KEY` — undo/redo walks up to the editor root directly.

Containers rebuild their `raw` from their inner children after every structural mutation. The `rebuildRaw` callback passed to `createStandardNestedActions` is the kind-specific rebuild helper (`rebuildBlockquoteRaw`, `rebuildListRaw`, etc.).

### Interactive Ambient Markers

A container's `ambientPrefix` can be inert text (the default) or carry interactive character ranges — clickable regions inside the read-only prefix. See the `AmbientPrefix` contract in `docs/design/editor/editor.md`.

- For inert markers, return a string from the component's prefix getter — the list-item's `- `, the blockquote's `> `.
- For markers with embedded interactive elements, return the object form with `text` plus one or more interactive ranges (character offsets, className, optional role/ARIA, click handler).

Keep the component thin: define a pure `buildXAmbient(metadata, onAction)` helper alongside the component and call it from the prefix getter. Task checkboxes follow this pattern — `buildTaskItemAmbient` in `src/lib/editor/components/blocks/list/task-checkbox.ts` is the canonical example. The helper is unit-testable without mounting the component, and render-path DEV warnings for malformed metadata live in the helper.

## Sticky column participation

Every editable block (prose or code) participates in the pixel-X sticky column system. When adding a new block type with its own editing surface:

1. **Capture on vertical arrows.** In `onKeyDown`, when the key is `ArrowUp` or `ArrowDown`, call `stickyColumn.capture(getCurrentCursorEditorRelativeX(el))`. The capture is idempotent — it only records if sticky is currently null.
2. **Reset on non-preserve keys.** In the same handler, for any key not in `PRESERVE_KEYS_NON_ARROW` and not a vertical arrow, call `stickyColumn.reset()`. Also reset on `onPointerDown`, `onCompositionStart`, `onCopy`, `onCut`, and `onPaste`.
3. **Implement `focusAtColumn`.** Expose a `focusAtColumn(x, from)` method that uses `findOffsetNearestX(el, x, from)` from `cursor/sticky-measure.ts` to position the cursor at the nearest offset on the first (`from === 'above'`) or last (`from === 'below'`) visual line.

`TextEditableBlock.svelte` and `CodeBlock.svelte` share the same implementation shape — reference either one.

## Adding a code-block language

To register a new code-block language for syntax highlighting, edit `src/lib/editor/components/blocks/code/code-bootstrap.ts`:

1. `import <name> from 'highlight.js/lib/languages/<name>';` at the top.
2. Call `registerLanguage('<name>', <name>, ['alias1', 'alias2']);` inside `bootstrapCodeLanguages()`.

No other file needs to change. The new language is available immediately on the next editor mount.

## Testing

Complex blocks (lists, tables) get a dedicated spec in `src/lib/editor/e2e/requirements/blocks/` and test file in `src/lib/editor/e2e/tests/blocks/`. Simple blocks are covered by the feature-level test suites.

Write the requirements first, then the tests, then the implementation.
