# Commits and undo

What happens once an edit has decided what to write: the undo stack it lands in, the commit every structural edit runs through, and the events it sends out. [`structural-edits.md`](structural-edits.md) is what the edits themselves do, and `editor.md` § Serialization is how the document becomes text again.

## Undo / redo

One unified undo stack; browser contenteditable undo is off. Each entry is a snapshot:

```ts
// undo/types.ts
interface UndoEntry {
	snapshot: Document; // shares nodes with the live tree, see below
	blockIds: string[]; // the top-level ID array, for stable keyed rendering
	selection: EditorSelection | GapCaretSelection; // anchor/focus in path addressing, or a gap position
	integrity?: number; // DEV-only digest, verified on restore
}
```

Collapsed, single-block, and cross-block selections all use that one `selection` representation. The stack is capped at 200 entries (nobody has asked for more yet), and on a restore the snapshot replaces the tree, so there's never a question of which state is correct.

**Snapshots share structure with the live tree.** An entry references the live nodes rather than cloning them, and each node carries an editor-level epoch mark (`ownerEpoch`) recording whether a snapshot still shares it, so pushing an entry costs O(top-level children), not O(all nodes). The cost moves to mutation time as **copy-path-on-write**: before any write, the chain of nodes from the document root down to the target is copied and the copies spliced in, so a shared node is never written through. The commit steps own this protocol. A commit copies the path down to each scope it touches and hands the mutation an owned children array; the mutation copies each child it writes before writing it (`tree-operations/unshare.ts`, which the `CommitScope` adapter's view offers as `unshareChild`), and never writes through a node reference captured before the commit.

**The aliasing contract is bytes-scoped.** A node a snapshot still shares is read-only _on its serialized bytes_: it may move within the tree, since restructuring rewrites no bytes, but any write to its bytes must copy first. The derived inline cache is exempt by construction, living in an external WeakMap and never on the node. This is invariant G1.9 ([`invariants/runtime.md`](invariants/runtime.md)); in dev an integrity check digests each snapshot on push and re-verifies at every commit and restore, so a violating write is caught at the commit that made it, not at the undo that exposes it.

**Triggers.** An entry is pushed before every structural operation and before every cut or paste (a copy writes nothing, so it pushes nothing). Text input is batched: consecutive keystrokes in one block group into a single entry, broken by pauses, focus changes, structural ops, and any cut or paste.

**An entry is only a step if it changes the document.** Type a letter and Backspace it, or paste the selected text over itself, and the entry still gets pushed, but the stack passes over it: Ctrl+Z goes straight to the step below, and `canRunCommand('history.undo')` (and redo) says no while nothing left on the stack would change a byte. Typing still clears the redo stack, even a run that changed nothing, same as every other editor. The check is cheap: an entry's top-level blocks are compared with the live ones by identity, bytes only where they differ, once per content version (`src/lib/undo/manager.ts`).

Every write to a block's text says which of those it is, as its `history`. Typing is `'join-typing'` (a Tab, and a key typed over a selection, count as typing). A command is `'entry'`: a format chord, a heading cycle, the code fence's language, a plugin source's commit. An `'entry'` write ends the burst before and after itself, so one Ctrl+Z takes back the command and leaves the typing on both sides. It's a required argument of `updateBlockContent` and a required field of `writeText`'s write, so a new write can't forget to pick.

**Where undo puts the caret.** The snapshot's selection path is read live from the focused leaf, so undo lands the caret on the exact leaf that was being typed in, including deep inside nested containers. The offset on that leaf is the one the caller supplies rather than the live (post-edit) one, so the caret goes back to where the edit began:

- For typed text a block reads that position at `beforeinput`, which every input route fires (a composition reads it where the composition starts), so dictation or a soft keyboard undoes in place like a keystroke.
- Every other edit passes where it began, never where it leaves the caret: a command its selection's start, a paste the start of the range it replaced (or the side a selected widget was selected from), and the paste dispatch hands that one offset to every commit it makes.
- When no ref reports a cursor (headless harness, handle drags, menu-driven ops), the path falls back to the commit's declared doc-absolute restore coordinate, so it resolves to the operated child rather than a scope-local index.
- While a widget is selected whole, the entry records the widget edge the selection came from (`docs/design/selection.md`).

**One gesture, one entry.** Plenty of gestures take more than one commit. A cross-block paste is a delete and then an insert, an IME composition over a range is a delete the composed text then joins (`continueTypingBurst`, below), a drop is a cut and then an insert, an inline-menu pick clears its query and then maybe inserts a block below, and replace-all is one commit per block it rewrites. Each runs its commits inside an undo step (`src/lib/action-contracts.ts` :: `CommitController`'s `undoStep(seed, run)`), and they undo in one press:

- The entry is pushed at the first write that actually lands. It holds the document from just before that write, and the selection as it stood when the step opened (a gesture often collapses its range before it writes anything; `seed` is the fallback when nothing's focused).
- Every later write in the step joins that entry, and a step that writes nothing leaves nothing.
- The step ends when the gesture's own work finishes, or earlier at the author's next input in that editor (a key other than a bare modifier, a keyless `beforeinput`, a paste, a cut or a drop), so typing while a plugin's commit waits gets its own entry.

A gesture can't push an entry ahead of its write; all it gets is the step. The code keeps that rule rather than the types forcing it, though. A commit outside a step still pushes its own entry, and the typing batch pushes at a burst's first keystroke, before the keystroke writes. A keystroke that changes its block (a new kind, or several blocks) commits with `history: 'join-typing'`, so that commit lands in the entry the keystroke already pushed, ending the burst. The join holds only because nothing awaits between the batch push and the commit call.

The other way round works too: after a commit, `CommitController`'s `continueTypingBurst()` makes the next typing write join the entry that commit wrote. A composition over a range is the one user, so the composed text lands in the entry its removal opened (compositionend ends the continuation with `endContinuedBurst`).

## The commit primitive

Every structural mutation routes through one internal commit helper. Three entry points name the three scopes (`src/lib/action-contracts.ts` :: `CommitController`): **`commitStructural`** (the document's children array), **`commitContainerStructural`** (one container's children array), and **`commitMultiScope`** (several container states in one logical step, a cross-container delete or an indent/unindent: one snapshot, one edit event, one atomic reactivity publish across every touched scope). The first two are just the third over a single scope, the document or one container, so every commit runs the same steps. A caller describes the change and the helper runs the commit steps around it, and each entry point resolves to whether any bytes landed (false when reading mode refused the write, the commit rolled back, or a `discardIfNoop` commit found nothing had changed). A commit can also pass `announce`, the line a screen reader hears about it ("Moved block to position 2 of 3"), spoken only after a commit that wrote. The split, from `editor-actions/block-edit-core.ts`:

```ts
await scope.commit({
	snapshot: { index: i, offset }, // where the caret goes back to on undo
	eventTarget: i, // the block the `edit` event names
	op: { kind: 'split', detail: { at: offset } },
	mutate: (view) => {
		/* cut view.children[i] at offset; return the structural change */
	},
	landing: () => scope.at(secondHalfIndex, [], CURSOR_EXACT_START),
	discardIfNoop: true // a split that moved nothing pushes no undo entry
});
```

The commit's steps, in order. `src/lib/editor-actions/commit/undo-controller.ts` :: `__commit` runs them all. The part from the reading-mode check to the `edit` event is the commit frame (`src/lib/editor-actions/commit/commit-frame.ts` :: `createCommitFrame`), which a keystroke runs too (below):

1. ask whether reading mode admits the write (below), and stop if not,
2. forget the caret memory and end the typing batch's current burst,
3. capture the snapshot (skipped when an open undo step or the typing batch already holds this gesture's entry, as above),
4. hand the mutation owned copies: the path down to each container scope, and a top-level children array of its own (the old one is what a throw puts back). With the document among the scopes that's a plain array off the `$state` proxy, published at step 8, since splicing the live one would pay a tracked write for every block it shifts,
5. run the mutation, then rebuild every path it wrote below a scope, deepest scope first and each container once. A mutation that reaches deeper than its scope's own list (a range delete, a format toggle across items, a paste into a list item) asks its scope for it: `own` copies a path, `writeLeaf` writes a leaf there with its fix-up, `splice` splices a list there with its fix-up (`src/lib/editor-actions/commit/scope-writes.ts`). That's why nothing outside the commit runs the fix-up, the chain rebuild or the open-tail step itself (G4.258),
6. run the one fix-up over each list the mutation wrote (`src/lib/tree-operations/fix-up/apply.ts` :: `fixUpEdit`, `structural-edits.md` § Structural operations). The mutation reports what its own kind did (a content write, a removed block, a move) through its scope's `describeEdit`, and the fix-up ends the line of every block it placed and of the block right above them, lays out the blank lines and merges the joins around the edit, then splices the result into the list,
7. give an emptied document its one empty paragraph (`src/lib/tree-operations/fix-up/apply.ts` :: `keepOneBlock`),
8. publish each scope's new children and ids, then rebuild every enclosing container's `raw`, deepest first and each container once, asking each container's own slot on the way out (`structural-edits.md` § The container `raw` contract),
9. if the file had no final line break before the commit, take the break off its new last line again, unless that line is blank (`src/lib/tree-operations/fix-up/apply.ts` :: `keepOpenTail`; `docs/design/syntax-tree.md` § Blank lines says why a blank one keeps it),
10. in a dev build, check every block the commit could have written,
11. bump the content version, clear a gap caret, and emit an `edit` event when the commit names an `op`,
12. `await tick()`, then read the caller's `landing` and put the caret there, awaited,
13. speak the caller's `announce` line in the edit live region, when the commit wrote.

A throw anywhere from the snapshot through the tail step (9) rolls the tree and the undo stacks back. A throw in the landing doesn't: the commit already succeeded, so it's reported on the `error` channel (§ The event channel) and the next edit runs as normal.

**The keystroke takes the same frame, minus the tick.** A key that keeps its leaf's kind (most of them) writes in place: `src/lib/editor-actions/commit/leaf-commit.ts` :: `createLeafCommit` copies the path down to the leaf, writes it, runs the fix-up over the leaf's list (step 6) and rebuilds the ancestors, all inside the frame, then hands back where the caret goes only if the write moved it off the leaf. So a keystroke gets what a commit gets: the rollback, the dev checks (scoped to the leaf and its ancestors, which keeps typing cheap), the content version, and an `edit` that fires before the decorations re-read anything. Two things differ:

- It pushes no undo entry and ends no burst. The typing batch already pushed the burst's one at its first key.
- A rolled-back keystroke rolls back only what that key wrote, and takes the burst's entry back with it when that key opened it. The character the browser already put on screen goes too: the block repaints from the tree.

The landing is a value, not a callback that places anything: a position (a document path and an offset, where the path may name a container) or a stored selection. The commit reads it after the tick, so it sees the tree the commit left, and hands it to the editor's one caret landing (`src/lib/selection/caret-landing.ts` :: `createCaretLanding`). That resolves the position to a leaf a caret can sit in, mounts each level on the way down, gives up if an undo, redo or document swap happened since the commit started, focuses the block through its own `focus` (a stored selection goes back at its exact bytes instead), and scrolls it into view when it's off screen. A few details, for the curious:

- A commit that reading mode refused lands nothing. One that `discardIfNoop` threw away still lands, since a refused merge still moves the caret across the boundary you pressed at.
- When an enclosing container collapsed during the commit, the collapse's position replaces the caller's, because the collapse rebuilt the blocks the caller's position names.
- In a dev build, reading the landing must leave focus and the selection alone, so a landing that sneaks in a caret of its own gets caught the first time a test runs it.
- A commit can say how far its landing moves the viewport (`reveal`). An ordinary edit scrolls only when the caret isn't fully on screen, just far enough to show it, and holds nothing after; a navigation holds its block where it landed.
- A gesture over a range that spans blocks gets one caret from the range replace, which holds each commit's landing instead of placing it (`CommitController`'s `holdLandings`) and then places the last one that wrote. An IME composition gets one too, before the IME writes anything, so the composition carries on in the block the removal kept.

Callers pick a scope; they never assemble the steps, and **this is the canonical entry for any new structural mutation** (the op-log isn't a commit step; it subscribes to `edit` downstream). The top-level and container action factories share one core through a `CommitScope` adapter, so the structural-edit sequence is single-sourced and the factories differ only in scope wiring and container-only concerns.

**Reading mode is refused where the bytes are written.** Every entry point that writes the document asks `src/lib/editor-actions/commit/reading-write-gate.ts` :: `admitsWrite` first: every commit and every keystroke written in place (both run the commit frame). Undo and redo ask its sibling `admitsHistoryRequest`. In reading mode each one declines, pushing no snapshot and emitting no event.

- A keystroke asks once, before it picks between a commit and the in-place write, and comes back with `admitted: false` and no caret. A dev build also warns `[aragonite:reading-write]`, since whatever got there offered a write it shouldn't have.
- The reading-mode checks still left on gestures hide an affordance, or keep a promise the refusal can't keep by itself (a `runCommand` that answers `false`, a key the editor still consumes).
- A mode switch commits whatever an open block is holding before the new mode takes effect, so that edit lands in the mode it was typed in.

The same check quietly refuses a write made for a document a `source` swap has replaced (a paste that waited on a slow clipboard read, say). Each write handle a block holds is stamped with the document it was made for (`src/lib/editor-actions/commit/document-stamp.ts`) as the block mounts.

**Nothing writes while an undo or redo puts its entry back.** From the document swap until the caret has landed, the gate declines every write, quietly. Otherwise a block that tidies itself up when the caret leaves it (an empty `#` heading turning back into a paragraph, say) would sneak a new edit into the middle of the undo and wipe the redo stack. The install awaits nothing but `tick()`, so no key or click can arrive inside it and get dropped. An open draft (an edit held outside the document, like a shown math source) commits just before the swap, as a step of its own the undo then takes back, so redo brings it back too. A shown source stays shown and fills with what the undo put back. In dev, G1.156 checks that the document ends up at the entry's exact bytes.

Two snapshots still come from outside the primitive. The typing batch's, pushed at a burst's first keystroke before its write, because a keystroke written in place pushes nothing of its own; and undo and redo's own, the current state they push onto the opposite stack before they swap (`captureCurrentState`).

**Persistent history.** The undo stack is session-scoped: in memory, cleared when the document closes. Cross-session history belongs at the save boundary, outside the editor, which only hands over the serialized document.

## The event channel

Anything outside the editor that wants to hear what happened subscribes through `getEvents()`: eight channels, each `on(name, cb)` returning a function that unsubscribes, fired synchronously from wherever the thing happened. What each channel carries, with sample payloads, is in the consumer's reference, `docs/guide/consumer-guide.md` § Events. This section is where each one comes from (six of them, anyway; `presentationModeChange` and `themeChange` just echo a prop change).

- **`edit`** fires at every write, as it lands. A commit that names an `op` emits that structural variant (`schema/operations.ts` lists them). A keystroke written in place emits `input` (`src/lib/editor-actions/commit/leaf-commit.ts`). The history layer emits `undo` / `redo` as it puts the entry back, before the caret's placed. And find/replace emits one `replaceBlock` for a whole replace-all, since its per-block commits name no `op`. Consecutive keystrokes share an undo entry, but that's all the batching does: each one still fires its own `edit` right away.
- **`selectionChange`** is sent from one place (`selection/selection-announcer.ts`), which drops a repeat of whatever it sent last. It hears the editor's own caret placements as they happen, writes to the selection state, a few explicit announcements (focus leaving, a document swap), and a bridge for the carets the browser places itself. The payload is read when the event goes out, so a gesture that writes the selection state and then moves the caret mustn't announce in between. The state store takes a batch for that, and the restore route wraps both halves in one (`docs/design/selection.md` § Cross-block selection). Selecting an image whole announces once, with the image's edge as the caret. Ending that selection announces nothing of its own, since whatever ended it announces itself.
- **`sourceSwap`** fires when a `source` prop write replaces the whole document, once the new tree, the cleared selection and the link references are in place. The decoration engine's `editEpoch` only catches up a tick later, so this channel is how a decoration source tells a swap from an edit. Before any of that, the swap throws away every draft. A draft is an edit that waits outside the document until it commits (a code fence's language field, a diagram's edit box, a math block's shown source), holding the bytes it opened on, and they're all kept in `src/lib/components/draft-registry.ts`. The torn-down block still blurs a render later, so a draft's commit asks `canWrite()` first and writes nothing to a document that's gone. A mode change closes the drafts too, after the switch's own blur has saved the focused one.
- **`menuChange`** reads one open-menu registry (`components/menu/menu-presence.svelte.ts`). Every menu and popover adds itself there along with its own close function, so it counts as open exactly while it's mounted. The registry closes each one on a click outside it or on Escape (newest first), wherever focus is, because Safari never focuses a clicked button and a menu waiting for its opener to blur would just stay open. A document swap and a mode change close them all with one call. The toolbar's heading flyout closes through the registry too, but with `trackUncounted`, so it never counts as open.
- **`searchChange`** comes from one `$effect` in `Editor.svelte` that compares `search-state.svelte.ts :: viewKey` with the last one it fired on, so whatever changes the search, it fires once per flush. A regex scan or a replace that's still running doesn't count as a change until it lands.
- **`error`** is where every failure the editor caught instead of throwing ends up. A subscriber that throws never starves the others, a block that throws falls back to a readable version while its siblings carry on, a decoration source that throws keeps its previous decorations instead of going blank, and a plugin command that throws does nothing. Origin `commit` also covers a replace-all that failed to build a subtree. The commit primitive section above says which throws inside a commit roll the tree back.

The debug op-log is a subscriber to `edit`, not a call from commit sites, and a future persistent-history layer hooks in the same way. One wrinkle: a paste's op follows the paste _strategy_, not the target's depth. A default structural paste into one leaf emits `replaceBlock`, the list and container absorb-and-merge strategies emit `paste`, and a paste that stays inline goes through the content write, so it reads as `updateContent` or `input`, same as typing. A consumer counting structural pastes matches the first two, and can't tell an inline one from typing.
