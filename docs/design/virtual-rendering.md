# Virtual rendering (windowing)

Windowing is why you won't feel your chunker of a file (say, 10 MB): the editor only mounts the blocks you can see, so a keystroke's reactive flush is gated to the viewport, not the entire doc. It's also why some files open at all, since a few shapes (thousands of tiny blocks, deep nesting, a giant table) never finish building their DOM if every block mounts. Ofc, this is real unmounting, not just skipping paint and layout with `content-visibility`; what we care about is the cost of the script, and a mounted component runs script on every keystroke whether it paints or not. The thing doing the windowing is the one rendering primitive the editor reuses everywhere: the root windows the top-level blocks, each container windows its own children, and so on for every layer (a "scope" from here on, meaning any parent and the list of children it renders).

---

<details>
<summary>How a scope windows</summary>

<p>A scope renders a contiguous slice of its children sandwiched between two spacers. What are spacers? Empty divs with a height and nothing in them; they stand in for the unmounted blocks above and below the slice by mimicking their total height (an estimate supplied by the height model, more on that below). Consequently aragonite scrolls for real instead of using some clever trick, and in my opinion it feels smoother when you do things like scroll to block N or autoscroll during a drag: the browser's scrollbar is the real one, and the scroll range is the real document height.</p>
</details>

---

To make sure each block has a stable index, the mounted blocks are rendered with the absolute index (the index you would use if there were no windowing). For every scope, the first block is 0, the fifth is 4, the seventh is 6, no matter where the viewport is or which slice is mounted. That gives every block a stable, absolute path (the list of indices from the root down to it), and life is easy. Same deal for the render keys: the slice keys on the block's id.

## How tall is a block nobody has rendered?

This is where the height model comes in. Every block gets a cheap guess from its source (roughly: how many lines this much text wraps to at this width; one line plus chrome (the parts of a block that are furniture, not content: a title row, a border) per child for a container; the `|WxH` hints for images; etc.), and the guess gets replaced by the real measurement the first time the block mounts (remembered by the block's id, ofc).

(Maybe Irrelevant) Details for the Curious:

- Guessing the height of a block is cheap (bounded at O(1)).
- A kind guesses its own height with its descriptor's `estimateHeight`, `(node, env) => px`, with the width and the text metrics (line heights, character width) in `env`. Every built-in picks a shape from `src/lib/schema/height-estimates.ts` (wrapped prose, one line, source lines, a container by its children), and a plugin that declares none gets the container shape or the prose one. A plugin with a weird height brings its own; the bundled mermaid plugin's is the whole story in one line:

  ```ts
  estimateHeight: () => 320, // the skeleton's fixed height; the real one replaces it on mount
  ```

  A block that truly can't know its height (a KaTeX render, say) gets guessed as prose and self-corrects on first mount. The pecking order: a collapsed container is guessed at one chrome row no matter what (its body never paints), then the kind's own guess, and a real measurement beats everything.

- For every scope, the heights live in a binary indexed tree (i.e. Fenwick tree), so "what pixel offset does block N start at" and "which block is at pixel P" are answered in log time.
- Measuring gets batched. Say 30 blocks get mounted: they're all measured at once and written (into the tree) at once, so the browser re-lays out once for the whole batch. The read waits until the flush that mounted them is done (still before paint), since a block's content can land later in that same flush and an early read records an empty box. An edit to a single mounted block re-measures just that block, through the same writer.
- The measured heights are cached (by block id, beside the tree), and that cache is thrown away if the whole document is replaced through the `source` prop, or if anything changes how a block renders (§ When and how everything re-measures).

## Keeping the page still while heights change

Here's a bad ux: you scroll up, a block above the viewport gets mounted (thus getting its real measurement), it turns out taller than the guess, and the content under your eyes slides down. So, to not have this, windowing self corrects: it reads the difference between the measurement and the guess off the height model, and scrolls by that difference. The browser only takes whole device pixels, so the fraction it refuses is carried into the next correction (throw it away and a mode switch correcting forty blocks above you drifts a whole pixel).

The rest of this section is how that stays true: who's allowed to scroll, which block gets held still, and how one flush of height changes becomes one scroll.

### Who writes the scroll

Every scroll write goes through one module, `src/lib/windowing/scroll-owner.ts`: the corrections, the header slot's growth, a scroll into view, the Shift+Arrow scroll, a plugin keeping its place across a view swap. Before each write it decides who owns the position right now (the browser's own anchoring, a held target, or the plain correction). Everything else only gets a read-only view of the scroller, and a lint catches a write that goes around it.

Some details:

- Browsers do their own scroll anchoring (they also try to correct for content growing above you), which would move the reader twice. So the editor turns the browser's anchoring off where it owns the scrolling (`scrollMode="self"`). On a host page, while windowing, it sidesteps the browser instead (withdraws its own subtree from the browser's anchor candidates); below the budget it corrects nothing and lets the browser's anchoring do its job.
  - Do note, while windowing in host mode, something growing in the page's own chrome above the editor goes uncompensated, because the editor's subtree is no longer an anchor candidate.
- The scroll mode only picks which scroller windowing reads (the editor itself, or the nearest scrollable ancestor / the page). Whether a scope windows at all is the budget's call.
- The sneaky writer is `focus()`, which scrolls an off-screen element into view all on its own. So every caret landing, arrow arrival and restore focuses with `preventScroll`, and whatever moved the caret asks the owner for the scroll instead. A new bare `focus()` fails a lint until it says why it's allowed to scroll.

### Which block stays still

The one your caret is in, if it sits at or below the viewport's top, so the line you're typing in doesn't budge when something above it changes height. Otherwise it's the block at the top of the viewport. A block the edit itself moved (Alt+ArrowUp, say) isn't held, since the whole point of moving it is to watch it move on a page that stays put ("moved" meaning its neighbours changed, not counting blocks the edit added or removed).

The pick is made once per round (next subsection) for the whole document, not once per list. It starts at the top-level list, and whenever the block it picked is a container, it goes down into that container's list and picks again, so it ends on the innermost block. The walk is `src/lib/windowing/list-tree.ts` :: `createListTree`, and every level picks through `src/lib/windowing/pinned-block.ts` :: `heldBlock`, whose types refuse a hand-picked block or a hand-written distance.

### One round, one scroll write

Lists don't scroll. They write heights into their tables, and the scroll owner turns everything written in one flush into at most one scroll write. That's a **round**:

1. It opens on the first height write (or just before a list rebuilds its table).
2. It picks the block to keep still, from the scroll and the tables as they are right then, and notes where that block sits.
3. Every height written before the next tick joins it, whatever wrote it: an edit re-measuring three nested lists, a rebuild, a mount batch, a size report.
4. At the tick it reads where the block sits now and scrolls by the difference (or not at all, when that's zero).

Again, some technical details:

- Where a block sits is one walk down the tables, the tree's `resolve`: the top-level list's offset of the container, plus the container's chrome and its own list's offset of the block, and so on down. A held target reads the same walk.
- Reading the block's place once before and once after is what makes a growth count once. An image growing inside a container shows up in the container's table and again in the list above it (the container got taller), but the block you're looking at only moved by it once.
- While a round is open, a list keeps the blocks it has mounted (and still mounts what the new table asks for). Until the correction lands the scroll doesn't match the table, and unmounting the block at the top would remount it fresh, from guesses.
- Every other scroll write the owner makes (a placement, a landing, the reveal's mount scroll) goes through `writeScroll`, which first measures any blocks still queued and closes the open round, and only then works out where to go. That's why `showRect` takes a read, not a rect: a rect measured before the correction is already stale.
- A list that needs a block mounted asks the owner to scroll to its path, never to a position.
- Chrome above the block list (the editor's header slot, or the host page's own) needs no special case in the window math, since a scope only counts the part of itself that overlaps the viewport. The header slot's growth still needs correcting (its height lives outside the height model), so it joins the open round as a distance of its own and shifts by the whole growth, except at the very top, where you're looking at the header anyway.
- While a window change renders, every list that renders spacers holds its box at its table's whole height with a `min-height` (`src/lib/windowing/use-window-floor.svelte.ts` :: `useWindowFloor`). Without it, a list mounting the blocks that just came into reach one at a time looks short to any layout read in between, and at the document's end the browser pulls the scroll up to fit and never gives it back (VR-16). The hold comes off when the render's done, before the browser's size reports, or it trips a ResizeObserver loop. A table's grid sets `align-content: start` so a held grid doesn't stretch its rows into the heights they get measured at.

### Things that grow after mounting

An image decoding, a font swapping in, a lazy embed: those have to be accounted for too, lest we cause the dreaded slide. So everything a list windows (a block, a list item, a table row) watches its own size, and its list corrects for any change.

- That's one hook, `src/lib/windowing/use-measured-child.svelte.ts` :: `useMeasuredChild`. It joins the batch at mount, measures again after an edit and on a resize, always into the child's own list under the child's own id. A list never reports its own height to the list above it; that list measures the container's box like any other child.
- Every watched child shares one ResizeObserver per editor, and its callback only records heights. The scroll write comes at the tick after, so nothing the correction moves lands inside the browser's size reports. The observer is made after the editor's own width watcher, so a width change rebuilds the tables before the blocks' reports arrive.
- A child starts watching its size one frame after it mounts, since a watch begun while the browser is still handing out size reports is skipped (and logged as a ResizeObserver loop error). The mount's own height comes from the batch anyway.

### For the curious

- Fun fact: a scope starts windowing when its estimated height clears a budget (4000px, a few viewports), and stops when it drops below a _lower_ one (3000px). If the two thresholds were the same, a doc that sits more or less exactly on the line would flip on and off with every keystroke, and each flip remounts blocks, and that would be bad.
- Unfortunately, the scrollbar thumb (the handle of the scrollbar) still drifts while guesses are being replaced by measurements, and it's the one visual artifact nothing corrects. Fortunately, it shrinks as more blocks get measured.

## When and how everything re-measures

Everything that throws heights away (a new document through `source`, and the rewraps below) goes through `src/lib/windowing/layout-state.svelte.ts` :: `createLayoutState`, the only thing holding the height estimator. It has two ways to do it: `forgetMeasuredHeights` drops the measured cache, and `rebuildForNewGeometry` drops it and bumps the width version (a counter every scope rebuilds its height model off).

**Narrow the window and prose rewraps, so every cached height is wrong.**

We drop the measured cache, rebuild each scope's height model, and remeasure the mounted blocks. The width is watched on a zero-tall div as wide as the editor, not on the editor itself, whose height changes with the very rebuild the watch sets off (another ResizeObserver loop).

**Resize the height only and nothing rewraps.**

The measurements survive; only the slice recomputes, since how many blocks fit comes from the viewport's height.

**Change the font size and every line box moves.**

This one's more annoying: the guesses have to follow the live computed font size (watched on a one-`em` probe, because a font-size change resizes no other box in the root), and then it runs the same drop-rebuild-remeasure as the width case. Skip it and the error is systematic, since a doc whose real height clears the budget can be guessed under it and never window at all.

**Flip the presentation mode and hidden markers appear or vanish, which rewraps too.**

Drops the measured cache. That's it actually, so we only eat a little drift instead of a full rebuild. The scopes keep the heights the dropped cache no longer backs, and a later structural rebuild (a split, an undo) carries them across too; only a width or type-scale change starts over from guesses (VR-15).

## Nesting

**Why does aragonite nest windowing?** I don't know who keeps asking these stupid questions, but here goes: because large containers need it, for example a long flat list with thousands of items (i dunno, some people are freaky like that). Each layer only ever sees its own children, so a huge nested list is one entry, one height, in its parent's model, and nobody has to look inside. It's also nice this way, because the wiring is just one hook (`windowing/use-container-windowing.svelte.ts`), so a plugin container inherits windowing by declaring only what's different about it (its DOM selectors, where its children come from, etc.).

## Doing something to a block you can't see

Example: undo lands the caret five thousand blocks away, search jumps to the next match, focus moves off the bottom of the window. To account for that, anything that must touch a block's DOM first reveals it: the editor walks its path (remember how absolute indices allow for stable, absolute paths? yeah, this is one of the uses) from the top, scrolling each windowed scope to the target, waiting for that target to mount, rinse and repeat till we finally get to the thing we touch. A level whose target is already mounted (in the window, in the overscan band (the few extra blocks mounted past each edge), or pinned) is skipped for free, so the common short hop resolves in a tick with no scroll.

Sometimes the block can never mount: it lives inside a collapsed `<details>` block, or a guess was off and the scroll missed. Reveal gives up instead of hanging, and that's fine. The document and the selection are data (paths and offsets, remember), the operation already did its real work on them, and only the very last step, putting the browser's caret in a DOM node, needed the block to exist. The caret shows up the next time the block mounts.

The collapsed `<details>` has one way out: a navigation (an outline click, a search match, `navigateTo`) opens it first, as one undoable edit. A caret never opens one, though, whether it's an edit's, an undo's or a collapsing range's; it lands at the end of the `<details>` title row instead.

Three more things about revealing, for the curious:

- **After an edit.** A commit's caret goes through `src/lib/selection/caret-landing.ts`, which reveals the target the same way. Then, if the caret still isn't fully on screen (Alt+ArrowDown past the bottom edge, say), it scrolls just far enough to show it at the nearest edge (the whole block when it fits on screen, the caret's line when the block is taller) and hands the viewport straight back. Undo, redo, a slash-menu pick and a link card edit land the same way, so a caret already on screen doesn't move the page.
- **Holding a target.** A search jump or a navigation has to _keep_ its target on screen, and images above it may still be decoding and shrinking the page under it. So such a scroll holds its target (aka the reveal anchor, the one held target the scroll owner keeps). The owner notes where the target landed on screen, and until you scroll, it puts the target back at that exact spot at every round's close, instead of holding the block the correction would pick otherwise. It reads the target's place through the same walk, so content growing inside the target's own container can't shove it off screen. The scroll counts as done once a flush goes by with no round in it.
  - Where the browser's anchoring is already holding the reader (host mode, under the windowing budget), the editor writes no scroll at all, held target or not.
  - Your own scroll gesture releases it (a gesture, not the `scroll` event, which the correction fires itself).
  - One target at a time: a newer scroll takes the slot and the superseded one just stops, since two things fighting over one scroll position is how you get jitter.
- **The pin.** The block you're typing in stays mounted even if you scroll it out of view, so focus and an in-flight IME composition survive. It has a cap: park the caret, scroll a hundred-odd blocks away, and the pin lets go and focus blurs. Rare, and fine.

## Selection

Selection endpoints are paths and offsets, i.e. data and not DOM, so copy, cut and delete walk the tree, and select-all-then-copy on a huge doc works with only a slice rendered. The highlight paints only on mounted blocks and flows with the viewport as you scroll. The caret end is always mounted (it's pinned, see above); the far end may be off screen and simply isn't painted, because, well, it's off screen. The screen-reader announcement is built from the same selection data, so it doesn't care what's mounted either.

## Tables

A giant table windows its rows the same way. The twist: a table is a CSS grid and a row has no box of its own, so a row's height is read off one of its cells, and the spacers span the whole grid width. Reveal descends row, then cell, so the caret still lands in the right cell of a row nobody has rendered.

## What the commit gate actually checks

Not a timing. It counts mounted blocks: a viewport's worth, plus a little overscan, plus the pinned block, no matter how big the document is. Everything outside that set has no component and no ref, and code that touches a block's DOM already null-checks. A count is the same on every machine and every build, so it never flakes, unlike every timing assertion ever written.

## The VR tags

Scattered through the windowing code, tests and e2e requirement files you'll see things like `(VR-2)` or `pins VR-5`. Those are tags for the windowing hazards this doc has been describing, the same idea as the `G` numbers the invariants carry: a comment at the line that guards against a hazard cites the tag instead of re-explaining the hazard, and this table is where you look it up. So `Do NOT restore overflow-anchor (VR-2)` next to an odd-looking line means "this is deliberate, and here's the one place that says why".

Adding one is simple. Pick the next free number, add a row here that says what the hazard is and what must stay true, then cite it from the comment or test that holds the line. Retiring one: delete the row and leave the number unused, so an old citation in git history still means what it meant (the numbering already skips VR-7, VR-10 and VR-13). A row nothing cites any more is a row to delete, not to keep for sentiment. A lint holds both halves: every tag cited under `src/` needs a row, and every row needs a citation.

| Tag   | The hazard, and what stays true                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VR-1  | Making the editor narrower rewraps prose, so every measured height is now wrong. The scope drops them and re-measures, and holds the scroll position while it does.                                                                                                                                                                                                                                                           |
| VR-2  | Jumping into a part of the document that was only ever guessed swaps guesses for real heights mid-render, which would slide the content. The editor's own scroll correction compensates, and the browser's built-in anchoring is off wherever that correction runs, and only there.                                                                                                                                           |
| VR-3  | A nested scope guesses heights at its own content width (a list inside a quote is narrower than the page), never at the width of the whole scrolling area. Its first guesses come before its box exists, so it guesses again once, when the box arrives.                                                                                                                                                                      |
| VR-4  | Measuring is batched: a scope reads every newly mounted height before it writes any of them back, so a fast scroll costs one browser layout per frame instead of one per block (and one per table row).                                                                                                                                                                                                                       |
| VR-5  | A reveal whose target can never mount (a collapsed body, a scroll that landed short) gives up instead of waiting forever. After the scroll it asks the list whether the target is in its mounted range: out of range ends the wait now, in range gets one render to mount.                                                                                                                                                    |
| VR-6  | Anything that decides "is there a block here" reads the document tree, not the array of mounted components, so a windowed document answers exactly like an unwindowed one.                                                                                                                                                                                                                                                    |
| VR-8  | A hard fling can scroll faster than blocks mount, so the spacers paint a faint placeholder tint rather than blank white, and the overscan band is wide enough that you rarely see it.                                                                                                                                                                                                                                         |
| VR-9  | The height model (the Fenwick tree) must survive a read or write outside its range without corrupting itself.                                                                                                                                                                                                                                                                                                                 |
| VR-11 | A scope only counts as "on screen" for the part of it that overlaps the viewport, so several scopes stacked in one viewport mount roughly one viewport's worth of blocks between them, not one each.                                                                                                                                                                                                                          |
| VR-12 | The synchronous focus paths can't reveal: they don't mount an off-screen block, so a caret sent farther than the overscan band silently goes nowhere. A commit's caret, a restored selection and a replace over a cross-block range reveal first, since they all go through the caret landing; a new route that lands a caret far away has to do the same.                                                                    |
| VR-14 | A block list builds its height table, and with it the choice to window, in the render pass that receives new children; only the scroll correction waits for the DOM update. No pass slices new children with the old children's window, so a swap to a huge document never mounts every block and an edit in a small one never drops its last block for a pass. A window whose end comes before its start collapses to empty. |
| VR-15 | A structural rebuild (a split, a paste, an undo) keeps a surviving block's measured height. Only a width or type-scale change starts the model over from the height estimator's guesses, so a measured cache dropped earlier by a mode switch can't turn a whole document back into guesses and scroll the reader by the difference.                                                                                          |
| VR-16 | A window growing upward mounts its new blocks one at a time, and a layout read between two of them sees a list short by the rest; at the document's end the browser pulls the scroll up to that and keeps it there. Every windowed list's box is held at its table's whole height while a window change renders, and let go when the render ends.                                                                             |
| VR-K1 | In a row-windowed table, index 0 of the mounted rows is the first _mounted_ row, not row 0 of the table, so column geometry must be read from whichever row is actually mounted.                                                                                                                                                                                                                                              |
