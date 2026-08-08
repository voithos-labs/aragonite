# The codebase map

Where things live, and what you must not do once you get there.

The design docs say how each subsystem works, and `docs/README.md` maps them by audience. This says
where a **behavior** lives: you know the editor did something wrong, and you need the one file to
open. Read it once end to end (about fifteen minutes), then come back to the table.

**Altitude.** Seams and responsibilities only. No line numbers, no signatures, no code. A file is
named by path; a symbol only where the symbol _is_ the seam, written `path :: Symbol`. That
notation is machine-checked (see the last section), so a reference here either resolves or the
gate goes red.

**How to read a row.** The entry is where you put the breakpoint. The rule is the thing that has
been broken before: nearly every one says the same thing in a different costume, which is design
rule 6, _rules live at choke points, not call sites_. When you want to add a branch at a seam, the
rule in that row is what you are arguing with.

## Behavior → seam

| Behavior                    | Entry                                                                                                                                                                          | The rule there                                                                                                                                                      | Spec                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Typing into a block         | `src/lib/components/blocks/editable-surface.ts` :: `createEditableSurface`, then `src/lib/tree-operations/node-ops.ts` :: `updateNodeContent`                                  | Bytes enter a node through `updateNodeContent`; a `raw` assignment at a call site is the bug                                                                        | `docs/design/editor.md` § 6                            |
| Keystroke batching for undo | `src/lib/editor-actions/commit/text-batch.ts` :: `createTextBatch`                                                                                                             | Its `setTimeout` detects a wall-clock pause, never ordering; sequencing is `await tick()`, and any new timing primitive needs a G4.4 allowlist entry                | `docs/design/editor.md` § 11                           |
| Enter / split               | `src/lib/schema/block-commands.ts` :: `dispatchKeyCommand`, then `src/lib/editor-actions/block-edit-core.ts` :: `createBlockEditCore`                                          | A kind gets Enter by declaring the chord in its `keymap`; the dispatcher never reads a kind name                                                                    | `docs/design/editor.md` § 8                            |
| Backspace at offset 0       | `src/lib/editor-actions/nested/nested-block-edit.ts` :: `createNestedBlockEdit`, strategies in `src/lib/editor-actions/unwrap-strategies.ts`                                   | A kind joins the cascade by declaring `unwrapRole` and a merge role, never by a branch in the cascade                                                               | `docs/design/editor.md` § 8                            |
| Caret landing               | `src/lib/selection/caret-doors.ts` :: `placeCaret`, dispatched by `src/lib/editor-actions/focus/focus-dispatch.ts` :: `dispatchMoveFocus`                                      | Mint `focus` from `placeCaret`, never by hand; `parkCaret` and `focusAtColumn` are extend-path doors (G2.12)                                                        | `docs/design/editor.md` § 4                            |
| Arrow at a block boundary   | `src/lib/selection/shared-keydown.ts` :: `handleSharedKeydown`                                                                                                                 | Every arrow boundary test lives at this seam, never at a call site; a surface growing its own arrow handling routes through it rather than comparing offsets itself | `docs/design/editor.md` § 8                            |
| Sticky column               | Capture via `noteKey` on `src/lib/cursor/sticky-column.ts` :: `createStickyColumnState`, consumed by `src/lib/editor-actions/focus/focus-landing.ts` :: `consumeStickyLanding` | Capture and consumption are separate seams; `focusAtColumn` is a pure receiver with no fallback of its own                                                          | `docs/design/editor.md` § 8                            |
| Caret edge affinity         | Captured via `note` on `src/lib/cursor/edge-affinity.ts` :: `createEdgeAffinityState`, consumed by `src/lib/components/blocks/text/edge-seat.ts` :: `resolveEdgeSeat`          | One arrival door and one editor-scoped instance; the seat is the one consumer, and it reads the kind's policy first and `get()` second                              | `src/lib/cursor/edge-affinity.ts` header               |
| Reorder (Alt+Arrow, drag)   | `src/lib/editor-actions/reorder-action.ts` :: `createReorderAction`                                                                                                            | The drag paints and mutates nothing; exactly one permutation commits, on drop                                                                                       | `docs/design/editor.md` § 8                            |
| Cross-block selection       | `src/lib/selection/selection-state.svelte.ts` :: `createSelectionState`, keys in `src/lib/selection/cross-block/dispatch.ts` :: `createCrossBlockHandlers`                     | Endpoints are `(path, offset)` data; never consult mounted DOM to decide what is selected                                                                           | `docs/design/editor.md` § 10                           |
| The gap caret               | arrival `src/lib/selection/gap-caret.ts` :: `tryGapStop`, eligibility `src/lib/selection/gap-caret.ts` :: `gapEligibleAt`                                                      | Eligibility is the kind's own `gapEdges` declaration; no kind list at the read site                                                                                 | `docs/design/editor.md` § 10                           |
| Copy / cut                  | `src/lib/components/blocks/editable-surface.ts` :: `createClipboardHandlers`, root fallback `src/lib/components/editor-root-clipboard.ts` :: `createEditorRootClipboard`       | `preventDefault` is the receipt the root seam reads; never claim an event a surface already handled                                                                 | `docs/design/editor.md` § 10                           |
| Paste                       | `src/lib/tree-operations/paste/dispatch.ts` :: `pasteDispatch`                                                                                                                 | One parse-and-route path; `src/lib/tree-operations/paste/paste-deps.ts` :: `PasteCommitCoordinator` is its only upward edge                                         | `docs/design/editor.md` § 10                           |
| Any structural mutation     | `src/lib/action-contracts.ts` :: `CommitController` (`commitStructural`, `commitContainerStructural`, `commitMultiScope`)                                                      | Pick a scope, never assemble the ceremony; mutate the scope view it hands you, not a reference captured before the commit                                           | `docs/design/editor.md` § 11                           |
| Undo / redo                 | `src/lib/undo/manager.ts` :: `createUndoManager`, driven by `src/lib/editor-actions/commit/history.ts` :: `createHistoryActions`                                               | A snapshot shares live nodes; a write to bytes a snapshot still shares must copy the path first (G1.9)                                                              | `docs/design/editor.md` § 11                           |
| Copy-path-on-write          | `src/lib/tree-operations/unshare.ts` :: `ensureUnsharedPath`, epochs in `src/lib/tree-operations/sharing.ts` :: `createSharingState`                                           | Copies are shallow; re-read through the `$state` tree after splicing one in, never keep the copy                                                                    | `docs/design/invariants.md` (G1.9)                     |
| Windowing                   | `src/lib/reactivity/list-windowing.svelte.ts` :: `createListWindowing`, slice math in `src/lib/reactivity/block-window.svelte.ts`                                              | Every index, id, and path key is `start + localIndex`; a loop-local index is the windowing bug                                                                      | `docs/design/virtual-rendering.md`                     |
| Reveal before act           | `src/lib/editor-rects.ts` :: `createEditorRects`, descent in `src/lib/reactivity/publish-ref.svelte.ts` :: `revealChildOrWait`                                                 | Reveal before touching DOM; a synchronous focus cannot mount an off-window target (VR-12)                                                                           | `docs/design/virtual-rendering.md` § Reveal Before Act |
| Search                      | `src/lib/search/search-state.svelte.ts` :: `createSearchState`, scan in `src/lib/search/document-scan.ts` :: `scanDocument`                                                    | The lens renders nothing and mutates nothing; replace is the only write, and it commits per affected subtree                                                        | `docs/design/editor.md` § 10                           |
| Decorations                 | `src/lib/decorations/decoration-state.svelte.ts` :: `createDecorationEngine`                                                                                                   | A source is a pure `doc → Decoration[]` memoized per edit epoch; a decoration never enters the CST                                                                  | `docs/design/plugin-contract.md`                       |
| Presentation modes          | Resolved once in `src/lib/components/Editor.svelte`, vocabulary in `src/lib/presentation-mode.ts` :: `PresentationMode`                                                        | Read the resolved mode, never the prop; a mode is CSS over the one render path, never a second one                                                                  | `docs/design/editor.md` § 4                            |
| Blank lines and separators  | `src/lib/tree-operations/node-ops.ts` :: `clearRedundantSeparator` and its settle siblings                                                                                     | Never assign `leadingTrivia` at a splice site; call a settle door and pass `sharing`                                                                                | `docs/design/syntax-tree.md` § Blank lines             |

What the table cannot carry is below. Keyboard leads, because it is the subsystem a newcomer reaches
first and the one whose shape is least guessable from the code.

## Keyboard and chords

Four facts, and then the manifest.

**`Mod` folds Ctrl and Cmd, unconditionally.** `src/lib/schema/keybindings.ts` :: `eventToChord`
turns a `KeyboardEvent` into a normalized chord, and `e.ctrlKey || e.metaKey` becomes the single
token `Mod`. There is no platform detection in the library, deliberately: no `navigator.platform`
read, no `isMac`, nowhere. A Mac user's Cmd and a Windows user's Ctrl produce the identical chord
string, so no branch downstream ever needs to know which one was pressed. The one platform read in
the tree is `src/lib/e2e/platform.ts`, in the Playwright harness, which has to press a real OS key.
That asymmetry is load-bearing: a bug where some branch reads `ctrlKey` alone and drops Cmd is
invisible to e2e (on a Linux runner, Meta _is_ the wrong key), so its regression guard belongs in
the unit suite, driven through a synthetic event.

**Three keymap tiers, and where a new branch goes.** A chord resolves through
`src/lib/schema/commands.ts` :: `resolveBinding`: the kind's own `keymap` (declared on its
descriptor), then the editor-global keymap, then the plugin-global tier that a plugin's
`registerGlobalCommand` binds into. A consumer's override map shadows all three, per kind then
globally. Container bubble resolution (`resolveKindBinding`) deliberately stops before the global
tier, so a container never re-fires undo for the leaf inside it.

A keystroke belongs in a keymap when it maps to a **command**: a named id the focused block's
`runCommand` or a global handler can run. Bare keys are welcome there (Enter, Tab, Backspace and
Delete are all ordinary keymap entries on prose kinds). A keystroke stays a hand-written keydown
branch only when the command channel genuinely cannot carry it: the gesture needs an event a
keydown does not have (whole-block copy needs a `ClipboardEvent`), or it belongs to a transient
state rather than a kind (a selected inline widget, an open menu's focus trap, the gap caret's
proxy). If you find yourself writing the second kind, you are adding a claiming site, and it must
join the manifest.

**The G4.29 authoring constraint**, verbatim from the header of
`src/lib/schema/reserved-chords.ts`:

> A manifested file keeps its literal key comparisons and modifier reads: the scan is structural on
> both axes, so factoring either behind a helper fails the gate until the scan learns the helper.

This is the one place the codebase's own choke-point instinct is inverted, and it surprises
everyone. Extracting four `e.key === 'ArrowUp'` branches behind a shared `isVerticalArrow()` helper
is exactly what design rule 6 asks for, and it will fail
`src/lib/test/invariants/lint/reserved-chord-manifest.test.ts`, because the manifest is derived by
scanning for those literals. The gate is buying something the extraction would cost: the public
`reservedChords()` answer that a host page uses to avoid colliding with the editor, kept honest by
construction. If you need the helper anyway, the scan has to learn it first.

**The manifest itself** is `src/lib/schema/reserved-chords.ts` :: `HARDCODED_CHORD_SITES`: one
entry per library file that reads a modifier flag, listing the chords it claims outside every
keymap and the key literals it compares. Read it there. It is not reproduced here, because a copy
of it is a copy that rots, and the gate only guards the original.

## The reveal road

The question this answers: a document is windowed, the block you must touch is not mounted, and you
need its DOM. Undo restore, a search jump, a consumer's `setSelection`, and a cross-block collapse
all hit this. It gets a paragraph because the chain runs through most of the rendering stack and no
single file along it names the whole road.

There are two primitives and callers choose deliberately.
`src/lib/components/Editor.svelte` :: `revealPath` is the **mount** primitive: it makes the target
exist, and promises nothing about the viewport. `src/lib/editor-rects.ts` :: `createEditorRects`
wraps it as `scrollTo`, which claims, mounts, scrolls, and settles. A history swap injects the bare
mount, so undo does not yank the viewport; a navigation injects the scrolling one.

The walk, in order. A caller that must touch DOM asks for a reveal instead of reaching for an
element. `src/lib/selection/selection-restore.ts` :: `restoreSelection` decides which path actually
needs to be on screen (a table endpoint reveals its deep cell, a gap caret reveals the block it
sits against) and hands that to the injected reveal. The scrolling wrapper claims
`src/lib/cursor/reveal-anchor.ts` :: `createRevealAnchorState` _before_ its first await, so the
pointerdown that triggered the jump cannot release its own pin. Then `revealPath` descends the path
one level at a time. At each level it calls `src/lib/reactivity/publish-ref.svelte.ts` ::
`revealChildOrWait`, which short-circuits when the child's ref slot is already populated and
otherwise asks the scope's `revealChild` (`src/lib/reactivity/list-windowing.svelte.ts` ::
`createListWindowing`) to write `scrollTop` straight from the height model's offset for that index.
After that scroll it re-checks `isInWindow`: this is the termination guarantee, VR-5. If the
recomputed window provably excludes the index, the reveal gives up now rather than awaiting a mount
that can never fire, and the caller degrades to operating on path state. If the index is in window,
`src/lib/components/BlockList.svelte` re-slices, `src/lib/components/BlockHost.svelte` mounts and
publishes its ref, and publishing wakes the pending wait. Event-driven, not a timer. The descent
recurses into the freshly published ref. Back at the top, the wrapper scrolls (skipping it if a
newer reveal superseded the claim) and then settles: a bounded loop that re-reads the rect after
each flush and stops once the block holds still, which is what survives images decoding above the
target and collapsing the document under it. Only then does
`src/lib/selection/native-bridge.ts` :: `applySelectionToDom` place the real caret.

Nested containers re-enter the same road through
`src/lib/reactivity/use-container-windowing.svelte.ts`, and a table's rows and cells through its own
`revealByPath`, which shares the wait.

## Blank lines and separators

A blank line between two blocks is not a node. It is the follower's `leadingTrivia`, which means a
blank paragraph **is** its follower's separating line, and any operation that fills, deletes, or
replaces a blank block has to re-mint a separator somebody else was relying on. Get it wrong and
byte round-trip stays green while the document reparses to a different block count on reload, which
is the failure mode this family exists to prevent.

The settle doors live together in one section of `src/lib/tree-operations/node-ops.ts`
(`clearRedundantSeparator`, `dropDoubledSeparator`, `restoreSeparatorOnFill`,
`restoreSeparatorAfterBlank`, `settleSeparatorOnBlank`). Two doors exist where one would seem to do
because their preconditions are facts about different nodes. Call sites worth knowing:
`src/lib/editor-actions/block-edit-core.ts`, `src/lib/selection/range-delete-ceremony.ts`, and
`src/lib/tree-operations/cleanup.ts`. Read `docs/design/syntax-tree.md` § Blank lines before
touching any of it: two byte-equivalent trivia shapes exist, and which one you are holding decides
which door applies.

## What a block must, may, and must not do

The interface is `src/lib/block-component.ts`, and each member's docstring is authoritative. This
is the shape of the obligation.

**Must**

- Expose `focus(offset)`, `getCursorOffset()`, and the `editable` and `focusable` flags. Those four
  are the whole required surface, and orchestration checks the flags before it calls anything.
- Mint every caret landing from `src/lib/selection/caret-doors.ts` :: `placeCaret`, so the
  range-ending policy stays batched with the landing at one seam.
- Clamp an out-of-range offset instead of throwing; `CURSOR_END` arrives as an ordinary number.
- Answer `getCursorOffset()` with `null`, never `0`, when the caret is not inside it.
- Render from `node.raw` on each render. The `node` prop is a bytes-readonly view by type.
- Ship with a kind descriptor and a component registration (and an opener, if the parser must
  recognize new syntax). See `docs/contributing/adding-a-block.md`.

**May**

- Implement the optional landing doors it can honestly answer: `parkCaret`, `focusAtColumn`,
  `focusByPath`, `revealByPath`. Omitting one is a supported answer; the caller falls back.
- Implement `measurePartialRects` (or `cellRect` for a grid) to paint as a selection endpoint.
  Without it, it gets the full-block overlay, which is correct for a middle block.
- Implement `runCommand` for block-local commands its keymap binds.
- Declare an O(1) `estimateHeight` on its descriptor, so windowing can size it before it mounts.
- Render whatever it likes. Contenteditable is not required: a static focusable element, a grid of
  cells, and an opaque diagram are all shipped block surfaces.

**Must not**

- Mutate the CST. It calls a typed editor-actions context function and the editor shell writes.
- Reconstruct bytes from parsed structure. Slice them out of `raw`. Every round-trip bug this
  project has had was a path that decided it could rebuild what it should have copied.
- Sequence with `setTimeout`, `requestAnimationFrame`, or a microtask. `await tick()` only.
- Cache inline content on the node or in reactive state; the render path computes it locally and
  reads no cache.
- Branch on another kind's name. A capability it needs from a peer is a descriptor field or a
  declarative probe, added once at the choke point every later kind inherits.
- Fake an optional member. A `measurePartialRects` that guesses is worse than the fallback.
- Reach a sibling, the DOM outside itself, or the editor directly. Props and context, always.

## Keeping this map fresh

Two things hold it, and one of them is not automatic.

`scripts/check-codebase-map.mjs` runs inside `npm run lint`. It reads every backticked `src/`,
`docs/`, or `scripts/` span in this file and asserts the path exists, and for a `path :: Symbol`
span, that the symbol appears word-bounded in that file. So a deleted file or a renamed export
turns the gate red on the commit that moves it. What the check does **not** do is notice that a
responsibility moved while both names survived, or that a rule stopped being true. That part is the
habit: **a moved seam moves this map in the same commit**, and the lint is the thing that reminds
you when you forget.

When the map runs out, go to `docs/README.md` and pick the design doc for the subsystem. This file
tells you which door to open; those tell you why the room is shaped that way.
