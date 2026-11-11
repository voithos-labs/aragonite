# Codebase map

Open this when you've just watched a behavior break (or been told to change one) and want the one file to open. Nobody reads it top to bottom, me included, so scan or grep for your behavior and skip the rest.

## How to read a row

A row is a behavior the way a bug report would say it, the entry to open, and the spec section behind it. The entry is where you'd set a breakpoint: a path, plus `:: Symbol` when the symbol is what you'd search for. Where a rule follows an entry, it's the mistake somebody already made at that spot. Most of them are rule 4 in `docs/contributing/rules.md` § The five rules: the logic lives at the one place every path goes through, so a new branch at a call site is the thing to question.

## Typing and input

| Behavior | Open | Spec |
| --- | --- | --- |
| A keystroke: typing into a block | `src/lib/components/blocks/editable/surface-write.ts` :: `createSurfaceWrite`. A new route that assigns a leaf's `raw` runs `legalizeWrite` first; the lint counts the route but can't check that. | `docs/design/editor.md` § Data flow |
| A command key (Enter, Tab, Mod+B), or a command run by id (`runCommand`) | `src/lib/schema/block-commands.ts` :: `dispatchKeyCommand` for a key, and `runCommandById` in the same file for an id. The dispatcher names no block kind; a kind's answer is its keymap or a command it registers. | `docs/design/editor.md` § The dispatch point |
| A letter typed beside a widget, or aimed away from the caret | `src/lib/components/blocks/editable/typed-insert.ts` :: `decideTypedInsert` | `docs/design/caret-placement.md` § 5. The next key, at an edge |
| What an input event asks for; IME composition, and whether a key can be a command (not the IME's, and naming a key) | `src/lib/browser/input.ts`, `src/lib/browser/composition.ts` | `docs/design/editor.md` § Browser engines |
| Enter or Shift+Enter over a selection in one block | `src/lib/schema/block-commands.ts` :: `runBlockLocalCommand`, which reads `src/lib/schema/commands.ts` :: `AFTER_SELECTION_REMOVAL_COMMAND_IDS`. A new line-breaking command joins that set by hand; nothing notices if it doesn't. | `docs/design/editor.md` § A line break over a selection |
| Typing a construct into existence (a table's delimiter row, block math's `$$`) | `src/lib/editor-actions/enter-completion.ts` :: `withEnterCompletion` | `docs/design/plugin-contract.md` § Enter completion |
| A typed delimiter writing its partner (auto-pair) | `src/lib/components/blocks/text/delimiter-autopair.ts` :: `resolveDelimiterAutoPair`. It declines a pair that would change the line's kind (a grown `****` is a thematic break). | `docs/design/live-mode.md` § 4.2 Typing at a hidden edge |
| A code block's language where the fence is hidden | `src/lib/components/blocks/code/CodeBlock.svelte` :: `commitLanguage`, the field in `src/lib/components/blocks/code/CodeBlockRail.svelte` | `docs/design/live-mode.md` § 4.7 The code rail |
| Image crop | `src/lib/components/image/ImageProperties.svelte` :: `applyCrop`. Nothing is written before the tick or Enter, so Escape restores the image with no undo entry. | `docs/design/inline-parsing.md` § One grammar per construct |
| A live-mode rewrite that removes bytes, read back before it's stored | `src/lib/core/inline/live-edit/read-back.ts` | `docs/design/live-mode.md` § 2. The discipline: candidates, verified by the painter |
| Walking the inline tree; a link's label, destination or title, read and written back | `src/lib/core/inline/walk.ts`, `src/lib/core/inline/scan/link-grammar.ts` and its inverse `src/lib/core/inline/destination-bytes.ts` | `docs/design/inline-parsing.md` § One grammar per construct, `docs/design/invariants/scans.md` § The entries (G4.56) |
| Presentation modes, and the kind cue (a typed kind change named at the block's corner) | `src/lib/presentation-mode.ts`, `src/lib/components/kind-cue.svelte.ts`. Read the mode in effect, never the `presentationMode` prop. | `docs/design/editor.md` § The editing surface, `docs/design/live-mode.md` § 4.8 What the hidden markers would have explained |

## The caret

| Behavior | Open | Spec |
| --- | --- | --- |
| A click outside any text, the offset a point inside a block names, and a block path read off a DOM node | `src/lib/selection/dead-space-caret.ts`, `src/lib/browser/point.ts` :: `caretOffsetAtPoint`, `src/lib/selection/path-lookup.ts` :: `readBlockPath` | `docs/design/caret-placement.md` § 2. Which block, and where in it |
| Links: whether a click follows one (or a widget), what Mod+K and Edit link edit, and link editing in live mode | `src/lib/activation-click.ts`, `src/lib/components/blocks/text/link-at-point.ts` :: `followTargetAt`, `src/lib/components/link-card/link-card-commit.ts` | `docs/design/live-mode.md` § 4.6 The link card |
| Where an edit, an undo or a restore puts the caret (caret landing), and the one writer of the native selection | `src/lib/selection/caret-landing.ts`, `src/lib/browser/caret-writer.ts` | `docs/design/caret-placement.md` § 3. The one way in |
| The caret the editor draws, and its shape (the format the next letter types in) | `src/lib/caret/drawn-caret.svelte.ts`, `src/lib/components/blocks/text/next-byte.ts` :: `nextByte` | `docs/design/selection.md` § The drawn caret |
| Where a caret key lands (an arrow across a widget, a word, Home and End) | `src/lib/caret/caret-motion.ts` :: `motionTarget` | `docs/design/caret-placement.md` § 5. The next key, at an edge |
| An arrow at a block boundary, and the sticky column | `src/lib/selection/shared-keydown.ts` :: `handleSharedKeydown`, `src/lib/caret/sticky-column.ts` | `docs/design/caret-placement.md` § 7. Leaving the block |
| Which side of a hidden marker the next letter takes (the caret edge rule) | `src/lib/components/blocks/text/edge-seat.ts` :: `hiddenEdges` | `docs/design/caret-placement.md` § 6. Which side of a hidden marker |
| A key beside an inline construct, a widget, a decoration or the container's marker; the inline mark vocabulary | `src/lib/components/blocks/text/edge-policy-dispatch.ts` :: `createEdgePolicyDispatch`, the policies in `src/lib/schema/inline-construct-policy.ts`. Hiding markers changes which markers show, never whether a widget, a decoration widget or the marker prefix answers the key (reading mode skips the last two). | `docs/design/caret-placement.md` § 5. The next key, at an edge, `docs/design/live-mode.md` § 3. Policy is data |
| What the caret remembers between keys: pending marks (a format toggled at a collapsed caret), the pending break (Shift+Enter at a block's end), the held space (a space typed at a hidden closer) | `src/lib/caret/caret-memory.ts`, one file beside it per record | `docs/design/live-mode.md` § 4.3 Format toggles at a collapsed caret: pending marks, `docs/design/live-mode.md` § 4.2 Typing at a hidden edge, `docs/design/editor.md` § Shift+Enter at the end of a block |
| Selecting an inline widget whole | `src/lib/selection/place-caret.ts` :: `selectWidgetWhole` | `docs/design/editor.md` § Atomic inline widgets |
| Keys and focus on a block focused whole (a divider, a plugin container) | `src/lib/editor-actions/container-block-component.ts` :: `handleWholeBlockKeys`, `src/lib/editor-actions/whole-block-focus-surface.svelte.ts`. Reading mode switches off the editing branches only. | `docs/design/structural-edits.md` § Whole-block focus |
| The gap caret | `src/lib/selection/gap-caret.ts` :: `canGapStop`, which the arrows (through `tryGapStop`) and a dead-space click both ask | `docs/design/selection.md` § The gap caret |

## Selection and clipboard

| Behavior | Open | Spec |
| --- | --- | --- |
| Cross-block selection: a key or a press over a range, what the range covers, and anything deleted, cut, typed or pasted over it | `src/lib/selection/cross-block/keydown.ts` :: `readRangeKeyRole`, `src/lib/selection/cross-block/pointer.ts` :: `handlePointerDown`, `src/lib/selection/range-coverage.ts` :: `rangeCoverage`, `src/lib/selection/cross-block/range-replace.ts` :: `replaceRange`, `src/lib/selection/cross-block/range-removal.ts` :: `removeThroughCore` (the bytes a removal takes are decided in `src/lib/range-edit/edit-range.ts` :: `editRange`). A new key over a range gets a role in `readRangeKeyRole` and a case in `handleCrossBlockActive`. A key that starts a range from a caret lives elsewhere: Mod+A in `handleCrossBlockEntry`, Shift+Arrow in `src/lib/selection/shared-keydown.ts`. | `docs/design/selection.md` § Cross-block selection |
| An indent key or a format toggle over a range | `src/lib/selection/cross-block/range-indent.ts` :: `indentRange`, `src/lib/selection/cross-block/format-toggle.ts` | `docs/design/editor.md` § The dispatch point, `docs/design/selection.md` § Cross-block selection |
| Table cells in a selection | `src/lib/core/coordinate-spaces.ts` :: `rowMajorCellIndex`, `src/lib/selection/primitives.ts` :: `cellPoint`. Use these two; no lint catches a hand-written `row * columnCount + col` or `{ cellCoordinate: true }`. | `docs/design/selection.md` § Cross-block selection |
| What a range paints over a block and between blocks, and when a selection or mark overlay measures again | `src/lib/selection/primitives.ts` :: `classifyBlockForSelection`, `src/lib/components/overlays/SelectionGapFill.svelte`, `src/lib/components/overlays/remeasure.ts` | `docs/design/selection.md` § Cross-block selection, `docs/design/invariants/scans.md` § The entries (G4.165) |
| Multi-click selection (word, block, drag), and how far a drag reaches into a block it takes whole | `src/lib/selection/multi-click.ts`, `src/lib/selection/drag-pointer.ts` :: `reachesWholeBlock` | `docs/design/selection.md` (its opening), `docs/design/selection.md` § Cross-block selection |
| Touch: a widget's own pointer gesture, a finger's press (a scroll, a long-press selection), its range taken over as the editor's, the selection handles, a table's row and column actions | `src/lib/selection/pointer-gesture.ts`, `src/lib/selection/finger-takeover.ts`, `src/lib/components/overlays/selection-handles.ts` :: `startHandleDrag` (a `touch: 'own'` drag), `src/lib/components/blocks/table/TableBlock.svelte` :: `showCellButton` | `docs/design/selection.md` § Cross-block selection |
| Dropping a dragged selection | `src/lib/selection/selection-drop.ts` :: `runDrop` | `docs/design/selection.md` |
| Copy and cut, and whether a selection is held | `src/lib/components/blocks/editable/clipboard-step.ts` :: `runClipboardCut`, `src/lib/selection/held-selection.ts` :: `holdsSelection`. A block that handled the event calls `preventDefault`, and the editor root reads that as handled. | `docs/design/selection.md` § Clipboard |
| Paste | `src/lib/tree-operations/paste/dispatch.ts` :: `pasteDispatch` | `docs/design/selection.md` § The paste pipeline |
| Find and replace | `src/lib/search/search-state.svelte.ts`, the writes in `src/lib/editor-actions/search-replace.ts` | `docs/design/selection.md` § Search |

## Structure: split, join, move

| Behavior | Open | Spec |
| --- | --- | --- |
| Enter splitting a block; Backspace, Delete or a list-item merge joining two; removing a block whole; deleting the last block, or a container's last child | `src/lib/tree-operations/node-ops.ts` :: `splitNode` with the joins beside it, `src/lib/selection/cross-block/range-removal.ts` :: `removeWholeBlock`, `src/lib/tree-operations/fix-up/apply.ts` :: `keepOneBlock`, `src/lib/editor-actions/nested/nested-block-edit.ts` :: `createNestedBlockEdit` (its last-child check) | `docs/design/structural-edits.md` § Structural operations |
| Backspace at a block's start, and the offsets a caret can reach past hidden markers | `src/lib/editor-actions/block-edit-core.ts` :: `mergeWithPreviousInterior` (a container's first child unwraps in `src/lib/editor-actions/nested/nested-block-edit.ts` instead), with the rules in `src/lib/schema/merge-rules.ts`. The start is the first offset `caretReachableBounds` gives (`src/lib/selection/shared-keydown.ts`), not 0. | `docs/design/structural-edits.md` § Backspace at the start of a block, `docs/design/live-mode.md` § 5. What does not change |
| What a destructive join writes where two leaves meet (merge, range delete, range replace), and the structure past a block's text (a setext underline, closing `#`s) | `src/lib/tree-operations/leaf-range.ts` :: `cleanJoinedRaw`, `src/lib/tree-operations/structural-suffix.ts` :: `joinKeepingSuffix` (and `cutKeepingStructure` beside it for a split's or a paste's cut). A hard break at the text's end goes after a closing `#` run (`sameLineSuffix` in `src/lib/core/inline/index.ts`). | `docs/design/live-mode.md` § 4.5 Joins clean up where they meet |
| Replacing a block with parsed blocks (paste, drop, unwrap) | `src/lib/editor-actions/block-edit-core.ts` :: `replaceBlock`. The old id carries over only to a first block of the same kind, and the caret is tracked through the fix-up's merges. | `docs/design/commit-and-undo.md` § The commit primitive, `docs/design/selection.md` § Clipboard |
| Reorder (Alt+Arrow, drag) | `src/lib/editor-actions/reorder-action.ts`, the drag in `src/lib/editor-actions/reorder-drag.ts` | `docs/design/structural-edits.md` § Structural operations |
| A container's raw after a child changed | `src/lib/tree-operations/chain-rebuild.ts` :: `rebuildUnsharedChain` (every keystroke and commit), `src/lib/schema/container-raw.ts` :: `rebuildContainerRaw` (one container) | `docs/design/structural-edits.md` § The container `raw` contract |
| A list item's marker and its column; text after a task marker | `src/lib/components/blocks/list/marker-column.ts`, `src/lib/tree-operations/list/reconcile-task.ts` :: `writeKeepingTaskMarker` | `docs/design/structural-edits.md` § Ambient markers, `docs/design/structural-edits.md` § The container `raw` contract |
| Blank lines and separators; whether text is blank, and Markdown whitespace | `src/lib/tree-operations/fix-up/apply.ts` :: `fixUpEdit` (and the section below), `src/lib/core/lines.ts` :: `isBlankText` | `docs/design/syntax-tree.md` § Blank lines |
| Where the caret ends up after neighbours merge | `src/lib/tree-operations/content-write.ts` :: `settledCaretPosition` for typing, `src/lib/tree-operations/container-offsets.ts` :: `leafAtRawOffset` for a paste or a join. Typing, a paste and a join all track the caret as a byte offset in the merged block, so they land it in the same place. | `docs/design/commit-and-undo.md` § The commit primitive |
| The trailing insert row | `src/lib/components/TailInsert.svelte`. It sits beside the block list, not in it, so the windowed list holds nothing but blocks. | `docs/design/caret-placement.md` § 2. Which block, and where in it |

## Commit and undo

| Behavior | Open | Spec |
| --- | --- | --- |
| Any structural mutation; one undo entry per gesture; a mutation writing below its commit scope | `src/lib/editor-actions/commit/structural-commit.ts` (several lists in one commit is `commitMultiScope`), `src/lib/editor-actions/commit/undo-controller.ts` :: `undoStep` (several commits, one entry), `src/lib/editor-actions/commit/scope-writes.ts` | `docs/design/commit-and-undo.md` § The commit primitive, `docs/design/commit-and-undo.md` § Undo / redo |
| Applying an edit that already knows its new bytes | `src/lib/editor-actions/commit/byte-splice.ts` | `docs/design/commit-and-undo.md` § The byte splice |
| Where a top-level block starts in the document's bytes, and what a write must say it changed | `src/lib/tree-operations/top-level-starts.ts` :: `measured` for a document nobody keeps, `src/lib/editor-actions/commit/kept-starts.ts` :: `createKeptStarts` for the editor's own, `src/lib/editor-actions/commit/commit-frame.ts` :: `FrameWrite` (`touched`) | `docs/design/invariants/runtime.md` (G1.209), `docs/design/invariants/scans.md` (G4.340) |
| Undo and redo, copy on write, keystroke batching | `src/lib/editor-actions/commit/history.ts`, `src/lib/tree-operations/unshare.ts`, `src/lib/editor-actions/commit/text-batch.ts` | `docs/design/commit-and-undo.md` § Undo / redo |

## Windowing and scroll

| Behavior | Open | Spec |
| --- | --- | --- |
| Windowing: which blocks are mounted | `src/lib/windowing/block-window.svelte.ts` :: `computeWindow`, wired per list in `src/lib/windowing/list-windowing.svelte.ts` | `docs/design/virtual-rendering.md` § What the commit gate actually checks, `docs/design/virtual-rendering.md` § For the curious |
| Every write to the scroll position, and the scroll held across a block's view swap | `src/lib/windowing/scroll-owner.ts`. For a swap, call its `keep` before the state change and run what it returns after the flush. | `docs/design/virtual-rendering.md` § Who writes the scroll |
| Which block a height correction keeps still | `src/lib/windowing/steady-block.ts` :: `heldBlock` | `docs/design/virtual-rendering.md` § Which block stays still |
| Heights: how a windowed child's reaches its list, when measured ones are thrown away, and a windowed list held at full height while its window changes | `src/lib/windowing/use-measured-child.svelte.ts`, `src/lib/windowing/layout-state.svelte.ts`, `src/lib/windowing/use-window-floor.svelte.ts` | `docs/design/virtual-rendering.md` § Things that grow after mounting, `docs/design/virtual-rendering.md` § When and how everything re-measures, `docs/design/virtual-rendering.md` § One round, one scroll write |
| Reveal before act: touching a block that isn't mounted | `src/lib/selection/caret-landing.ts`, and the section below | `docs/design/virtual-rendering.md` § Doing something to a block you can't see |

## Plugins and registries

| Behavior | Open | Spec |
| --- | --- | --- |
| A block kind's declaration, and what its component must provide | `src/lib/schema/built-in-descriptors.ts` :: `registerBuiltInDescriptors`, `src/lib/block-component.ts` :: `BlockComponent` | `docs/design/editor.md` § The block-kind descriptor, `docs/design/editor.md` § The block interface |
| Adding a code-block language | `src/lib/components/blocks/code/code-bootstrap.ts` | `docs/design/plugin-contract.md` § The registries: global, register-once |
| Which plugins one editor runs, who a registry entry belongs to, and a built-in syntax switched off (`syntax` prop) | `src/lib/schema/plugin-activation.ts`, `src/lib/schema/plugin-registry.ts`, `src/lib/schema/registry-view.ts` :: `createRegistryView`. A switched-off syntax leaves the grammar only; a block of that kind still renders. | `docs/design/plugin-contract.md` § Per-instance enablement |
| A plugin block drawn with plain DOM; a plugin's inline widget, decoration widget or menu row | `src/lib/schema/block-view.ts` :: `defineBlockView`, `src/lib/components/dom-block-view/DomBlockView.svelte`, `src/lib/plugin-view.ts` | `docs/design/plugin-contract.md` § Block views, `docs/design/inline-parsing.md` § 6. Widget render paths |
| Decorations; mark hover and keyboard activation | `src/lib/decorations/decoration-state.svelte.ts`, `src/lib/decorations/mark-hover.ts` :: `createMarkHover`, `src/lib/decorations/mark-activation.ts` :: `createMarkActivation`, with `src/lib/decorations/mark-interactions.ts` :: `comparePrecedence` picking between overlapping marks | `docs/design/plugin-contract.md` § Decorations |
| Inline menus (a list under the caret on a typed trigger) | `src/lib/inline-menu/inline-menu-session.ts` :: `findOpening`, the open session in `src/lib/inline-menu/inline-menu-state.svelte.ts` | `docs/design/plugin-contract.md` § Inline menus |
| The insert catalogue and slash commands | `src/lib/schema/insert-catalogue.ts`, `packages/slash-commands/src` | `docs/design/plugin-contract.md` § Insert catalogue |
| A first-party plugin package, the plugin template, the plugin check and the listing | `packages/<name>/src`, `packages/create-aragonite-plugin/template`, `bin/aragonite-plugin-check.mjs`, `scripts/plugins/listing.mjs` | `docs/guide/plugin-testing.md` § The check a listing runs |

## The host API

| Behavior | Open | Spec |
| --- | --- | --- |
| Mounting from React, Vue or plain JavaScript | `src/lib/create-editor.ts` :: `createEditor`. The React and Vue wrappers hold no editor behavior; what both need goes here or in the editor, never in one wrapper. | `docs/guide/consumer-guide.md` § Mounting without Svelte |
| Which props can change after mount, and which are booleans | `src/lib/editor-props.ts` :: `EDITOR_OPTION_SPECS` | `docs/guide/consumer-guide.md` § Props |
| The prebuilt build (what a React, Vue or plain JavaScript app runs) | `vite.prebuilt.config.js`, gated by `scripts/pack/verify-prebuilt.mjs` | `docs/guide/consumer-guide.md` § What your build needs |
| When a `source` write replaces the document | `src/lib/components/editor-root/document-swap.ts` | `docs/design/editor.md` § Serialization |
| Programmatic insertion (`insertMarkdown`) | `src/lib/components/editor-root/focused-surface.ts` :: `insertMarkdown` | `docs/guide/consumer-guide.md` § Inserting Markdown at the caret |
| The block context menu (right-click), the rows a kind registers, and the selection toolbar | `src/lib/components/editor-root/menus.ts` :: `onRootContextMenu`, `src/lib/schema/context-actions.ts`, `src/lib/components/menu/SelectionToolbar.svelte`. A menu row writes through the editor's own actions, never by touching the DOM. | `docs/design/selection.md` § Clipboard, `docs/guide/consumer-guide/recipes.md` § Recipe: a selection toolbar |
| What `selectionChange`, `menuChange` and `searchChange` report | `src/lib/selection/selection-announcer.ts`, `src/lib/components/menu/menu-presence.svelte.ts`, `src/lib/search/search-state.svelte.ts` :: `viewKey` | `docs/design/commit-and-undo.md` § The event channel |

## Keyboard and chords

`Mod` is Ctrl or Cmd, always. Chord matching folds the two keys into one token (`src/lib/schema/keybindings.ts` :: `eventToChord`), so there's no platform to detect. The single platform read in the tree is `src/lib/schema/platform-conventions.ts` :: `usesMacEditingConventions`, for Apple's own conventions, such as Cmd+Arrow for a line's start and end, Option+Arrow for a word, and where a forward word delete stops.

- **What that costs the tests.** Playwright presses a real OS key, so helpers write editor chords with its `ControlOrMeta` key, and `src/lib/e2e/platform-keys.ts` has the per-platform modifier for word jumps and word deletes. Worse, code that checks `ctrlKey` and forgets Cmd passes every e2e run on a Linux runner, so its regression test goes in the unit suite, on a synthetic `KeyboardEvent`.
- **How a chord resolves.** `src/lib/schema/commands.ts` :: `resolveBinding` asks the host's overrides, then the kind's keymap, then the editor-wide keymap, then the plugins' global keymap. A chord that bubbles to a container stops before the global keymaps (`resolveKindBinding`), or undo would fire twice, once for the leaf and once for its container.
- **Where a new key goes.** In a keymap, whenever the key maps to a named command. Bare keys like Enter, Tab and Backspace are ordinary keymap entries.
- **When a hand-written keydown branch is fine.** Three cases: keydown can't supply the event you need (copying a whole block needs a clipboard event), what the key does depends on where the caret is (a block edge, a table cell), or the key belongs to a passing state, not a kind (an inline widget selected whole, an open menu, the gap caret).
- **The chord manifest.** Every library file that reads a modifier flag gets an entry in `src/lib/test/invariants/lint/hardcoded-chord-sites.ts` :: `HARDCODED_CHORD_SITES`: the key literals it compares and the chords it takes. Each chord must already be in the public `reservedChords()` set (`src/lib/schema/reserved-chords.ts`), which keeps that set honest for a host page avoiding collisions.
- **The one place rule 4 runs backwards.** A file in the manifest keeps its literal key comparisons. Pull them into a shared helper and `src/lib/test/invariants/lint/reserved-chord-manifest.test.ts` breaks, since it matches the listed keys against literals in the file. Want the helper? Teach the scan first.

## Reaching a block that isn't mounted

Windowing mounts only the blocks near the viewport, and focusing a block synchronously mounts nothing. So undo, a search jump, a host's `setSelection` and a collapsing range all reveal their block first, through `src/lib/selection/caret-landing.ts`. The method depends on who's asking.

| You are | Call |
| --- | --- |
| A navigation (an outline click) | `navigate`. It mounts, scrolls once, and keeps the block still while heights catch up. |
| A reveal with no caret (a search match, a host's `getRects().reveal` or `scrollTo`) | `mount`, with `openCollapsed`. Only it and `navigate` open a collapsed container. |
| The caret of an edit | `land` |
| A selection being restored (undo, redo, `setSelection`) | `restore` |
| The moving end of a Shift+Arrow range | `showSelectionEnd` |

- A caret endpoint inside a table resolves through `src/lib/selection/selection-state.svelte.ts` :: `cellLandingFor`. Resolve the table, row, cell path by hand and a cell index becomes a character offset.
- Every child list says whether an index is outside its window (`src/lib/block-lists/child-list.ts` :: `isInWindow`), so a descent can stop.
- Every write to the editor's scroll position goes through `src/lib/windowing/scroll-owner.ts`, bar a drag's autoscroll.

## Blank lines and separators

The blank line between two blocks isn't a node. It's stored on the lower block, so filling, deleting or replacing a blank block can remove a separator its neighbour counted on. Get it wrong and the document saves fine, then reopens with a different block count (`docs/design/syntax-tree.md` § Blank lines). So outside the files `src/lib/test/invariants/lint/separator-write-doors.test.ts` lists with a reason, nothing assigns a block's leading blank lines where a splice happens. An edit tells the commit what it did, or splices through the commit's scope, and one of three entries does the fixing.

| Entry | Who goes through it |
| --- | --- |
| `src/lib/tree-operations/fix-up/apply.ts` :: `fixUpEdit` | The commit, once for each list it wrote. A mutation writes with `writeNodeContent` and reports through its scope's `describeEdit`. |
| `src/lib/tree-operations/content-write.ts` :: `updateNodeContent` | A write no commit fixes up: the keystroke written in place, its trial reparse, and a leaf written below the commit's scope (a paste's leftover text in a list item, for one). |
| `src/lib/tree-operations/fix-up/apply.ts` :: `spliceFixedUp` | A splice a commit scope makes into a list below its own (`src/lib/editor-actions/commit/scope-writes.ts`). |

Hand calls are rare, and most give their reason at the call site:

- `insertParagraph` in `src/lib/editor-actions/block-edit-core.ts`, which the gap caret and the trailing insert row use, calls `restoreSeparatorOnFill`. The fix-up can't infer that the block pushed off the first position now needs a separator.
- The list item moves in `src/lib/tree-operations/list/item-moves.ts` call `settleSublistSeparator`. A move can leave a sublist whose first marker line is empty, which can't interrupt the paragraph above (the pair reloads as a setext heading), and the new sublist sits below what the commit rebuilds.
- `splitNode` in `src/lib/tree-operations/node-ops.ts` calls `mergeJoinsAt` on the join its second half makes. The commit loses sight of that join once a list item's split moves the second half into a new item.
- The ancestor rebuild in `src/lib/tree-operations/chain-rebuild.ts` calls `settleSublistSeparator` too, when a list is rebuilt down to an empty marker, before it checks the join above.
- Only the commit checks the join at a container's own position in its parent (`src/lib/tree-operations/chain-rebuild.ts` :: `rebuildUnsharedChain`). A path a mutation owned below a scope skips it, since its list ids come from the change the mutation reported.
- A file that ended without a final line ending keeps it that way through any edit (`keepOpenTail`), unless the new last line is blank.
- Some joins reopen as fewer blocks, like a paragraph right on top of its own setext underline. The tree takes the reading a reopen would give, and `src/lib/tree-operations/fix-up/merge.ts` :: `mergeAt` decides, once `src/lib/tree-operations/fix-up/joins.ts` :: `partJoin` has kept a moved block apart (`docs/design/structural-edits.md` § Structural operations).

## Adding a row

A new row has the same three parts as the rest, with the behavior in a user's words. No line numbers, no signatures. `npm run docs:map:check` resolves every path, every symbol written after `::` and every section here, so it catches a deleted file or a renamed symbol in the commit that does it. It can't see logic that moved while both names stayed put. So when you move an entry point, update this map in the same commit.
