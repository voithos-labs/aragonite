# Adding a New Block Type

How to add a block type to the CST editor. See `docs/design/editor/editor.md` for the architecture.

## Where Blocks Live

Block components live in `src/lib/editor/components/blocks/`. Orchestration components (Editor, BlockList, BlockHost) stay in `src/lib/editor/components/`. Editor action bundles and the container helpers they compose (nested-actions, list-context, blockquote-overrides, focus-dispatch) live in `src/lib/editor/editor-actions/`; the shared reactive state bundle (`block-list-state`) and its `state-registry` live under `src/lib/editor/reactivity/`. Block-kind and block-component registries live in `src/lib/editor/schema/`. Pure DOM helpers split by concern: `src/lib/editor/ambient/` for ambient-prefix offset and rendering helpers, `src/lib/editor/cursor/` for cursor, sticky-column, and overlay measurement helpers.

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
- `CONTAINER_EDIT_KEY` → `ContainerEditActions` — structural `commitContainer` (preferred) plus two out-of-primitive seams: `pushDebouncedCheckpoint` brackets routine typing mutations that happen outside the commit primitive, `nudgeReactivity` publishes those raw changes up to Svelte. Prefer `commitContainer` here (or `commitMultiScope` via `CONTROLLER_KEY`) unless the caller has reason to mutate raw itself (cross-block typing, drag/clipboard sync mutate).

A block reads only the sub-interfaces it actually uses. Containers set only the sub-interfaces they override for their nested children; Svelte context walking delivers everything else from the nearest ancestor that does set it.

The undo/commit _ceremony_ (commit primitive, snapshot debounce) lives in `editor-actions/undo/undo-controller.ts`; `undo/` holds only the undo stack and its entry type.

## Registration

Two registration steps per new block kind:

1. **Descriptor** — call `registerBlockKind(kind, descriptor)` in `schema/block-kind-descriptor.ts` with the core fields (merge role, editable / container / inline-support flags) plus whichever optional hooks apply (content range, container contract, container paste-merge, unwrap strategies, image-widget opt-out, foreign-drag hit-test, and a `keymap` of declarative chord → command bindings) — `BlockKindDescriptor` documents each. Container kinds declare `rebuildRaw` at registration (implementations in `schema/container-rebuilders.ts`) and may declare `unwrapRole` (Backspace-at-start strategies — see `editor-actions/unwrap-strategies.ts`). Kinds the block parser must dispatch also register an opener — `registerBlockOpener(kind, { priority, tryOpen, interruptsParagraph })` in `schema/block-openers.ts`, with built-ins registering theirs from `core/parsers/built-in-openers.ts`; kinds that emerge from the paragraph fallback (setext, table) skip this. Opener priorities must be unique (G1.10 fires loudly at bootstrap) — slot new kinds against the built-ins' 10–80 ladder.
2. **Component** — call `registerBlockComponent(kind, { component, extraProps? })` in `components/built-in-blocks.ts`. `extraProps` returns any per-node props beyond the standard `{ node, index, myPath, ambientPrefix, ref }` set (e.g. TextEditableBlock's `blockClass`). BlockHost looks up by kind via the registry.

A component that declares a `keymap` (or can be a cross-block focus target) implements `runCommand(id, arg?): boolean` — the block-local command bodies the keybinding dispatcher invokes; new command ids are added to `BLOCK_COMMAND_IDS` in `schema/commands.ts`, and G1.11 fires at bootstrap if a keymap references an unknown command or duplicates a chord. See `docs/design/editor/editor.md` § Schema for the command registry. New command ids must read the caret live (`cursor.getRaw()`), not a keydown-captured offset, so cross-block dispatch works.

Consumers (merge-rules, BlockHost, SelectionOverlay, paste-dispatch, inline pipeline, container-raw dispatch) read from these registries rather than each maintaining their own per-kind list.

## Container Blocks

Containers build their reactive state and default action bundle through the `editor-actions/` primitives, then override only the methods that need kind-specific behavior.

- `createBlockListState(node)` — reactive `innerBlockIds` / `innerBlockRefs`. Structural mutations on the container's children go through the commit primitives on the editor's `UndoController` (`commitContainer` via the `ContainerEditActions` context, or `commitMultiScope` via `CONTROLLER_KEY` for cross-container ops) — both apply `StructuralChange` descriptors to keep ids/refs aligned with children.
- `createStandardNestedActions(state, deps, overrideFactory?)` — generates a complete `{ blockEdit, focus, containerEdit }` bundle from the state bundle. Methods in the bundle handle the split/merge/delete/updateContent/replaceBlock ceremony uniformly, and Backspace-at-start dispatches by the kind's declared `unwrapRole`; containers with kind-specific behavior pass an optional `overrideFactory` as the third argument. The factory receives the fully-built default bundle and returns per-sub-interface partial overrides; overrides chain to the default by calling `defaults.blockEdit.splitBlock(...)` etc. directly.
- `dispatchFocusByPath` / `dispatchFocusAtColumn` — the pure dispatchers a container's `focusByPath` / `focusAtColumn` exports delegate to.
- `setNestedActionsContexts(bundle)` — the three-setContext helper that publishes the bundle to nested descendants.

A trivial container (future admonition block, collapsible section, etc.) calls `createStandardNestedActions(state, deps)` with no overrides and is done. A non-trivial container (list, blockquote) passes an `overrideFactory` that returns only the methods it customizes — see `list-overrides.ts` and `blockquote-overrides.ts` under `editor-actions/` for canonical extracted examples. The override set is visible at the call site, type-checked against each sub-interface, and stable references to the defaults are captured in a closure the overrides control — no post-construction method reassignment.

Containers don't set `HISTORY_KEY` — undo/redo walks up to the editor root directly.

Containers don't rebuild their own raw — the commit primitives rebuild the unshared spine after every structural mutation; the kind's `rebuildRaw` (declared at registration) is what that chain rebuild invokes.

### Virtual Rendering

Leaf blocks need no windowing work — BlockHost measures their height generically, so VR is invisible to a leaf author.

A container renders a windowed slice of its children. It wires one hook, `useContainerWindowing(deps)`, supplying thunks that name its variation:

- `getIndex` / `getParentPath` — this scope's slot in its parent and its own path.
- `getChildren` / `getChildIds` — the live child nodes and their ids.
- `getListEl` — the content-origin element that scrolls with the children (holds the spacers and items), never the viewport.
- `getOwnEl` — the element the parent measures for this scope's height (omit at the root).
- `provideLeafChannel` — `true` when direct children are BlockHosts (blockquote, list-item), `false` for direct-`{#each}` scopes (list, table).

The hook reads the windowing contexts — height oracle, focus path, width version, parent sink — internally; the author never touches the oracle, Fenwick model, sinks, or channels. It returns a handle: render the window slice into the `{#each}`, and feed `revealChild` / `isInWindow` into `createContainerBlockComponent` so off-window focus and path reveal resolve a mounted child.

Copy from `ListBlock.svelte` (direct-each) or `TableBlock.svelte` (row windowing).

### The Owned-Scope Contract

Undo snapshots share the live tree's nodes, so a container commit hands its `mutate` an owned `ContainerScope` — the container already copied out of sharing, with its working `children` attached. Write through `scope.node` / `scope.children`, never through references captured before the commit; those may be snapshot-shared originals, and writing through them corrupts undo history (invariant G1.9).

```ts
// wrong — `node` (the component prop) may still be shared with an undo entry
mutate: (scope) => deleteNode(node, index, scope.sharing);

// right — the scope view is yours to mutate
mutate: (scope) => deleteNode(scope.node, index, scope.sharing);
```

The same rule covers `commitMultiScope`'s per-scope views. Writes outside a commit (e.g. raw sync after routine typing) go through `withUnsharedSpine`.

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
