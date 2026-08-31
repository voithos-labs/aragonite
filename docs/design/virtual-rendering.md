# Virtual rendering (windowing)

Windowing is why you won't feel your chunker of a file (say, 10 MB): the editor only mounts the blocks you can see, so a keystroke's reactive flush is gated to the viewport, not the entire doc. It is also why the file opens at all: some shapes (thousands of tiny blocks, deep nesting, a giant table) never finish building their DOM if every block mounts. Ofc, this is real unmounting, not just skipping paint and layout with `content-visibility`; what we care about is the cost of the script, and a mounted component runs script on every keystroke whether it paints or not. The thing doing the windowing is the one rendering primitive the editor reuses everywhere: the root windows the top-level blocks, each container windows its own children, and so on for every layer (a "scope" from here on, meaning any parent and the list of children it renders).

---

<details>
<summary>How a scope windows</summary>

<p>A scope renders a contiguous slice of its children sandwiched between two spacers. What are spacers? Empty divs with a height and nothing in them; they stand in for the unmounted blocks above and below the slice by mimicking their total height (an estimate supplied by the height model, more on that below). Consequently aragonite scrolls for real instead of using some clever trick, and in my opinion it feels smoother when you do things like scroll to block N or autoscroll during a drag: the browser's scrollbar is the real one, and the scroll range is the real document height.</p>
</details>

---

To make sure each block has a stable index, the mounted blocks are rendered with the absolute index (the index you would use if there were no windowing). For every scope, the first block is 0, the fifth is 4, the seventh is 6, no matter where the viewport is or which slice is mounted. That gives every block a stable, absolute path (the list of indices from the root down to it), and life is easy. Same deal for the render keys: the slice keys on the block's id, never its position in the loop.

## How tall is a block nobody has rendered?

This is where the height model comes in. Every block gets a cheap guess from its source (roughly how we guess: how many lines would this much text wrap to at this width; one line plus chrome per child for a container; the `|WxH` hints for images; etc.), and the guess gets replaced by the real measurement the first time a block mounts (and is, ofc, remembered and linked to that block's id).

(Maybe Irrelevant) Details for the Curious:

- Guessing the height of a block is cheap (bounded at O(1)).
- Plugins with tricky heights can supply their own `estimateHeight` function, just in case. The pecking order: a collapsed container is guessed at one chrome row no matter what (its body never paints), a plugin's `estimateHeight` beats the built-in guess, and a real measurement beats everything.
- The worst case for guessing is a block whose height has nothing to do with its source (a Mermaid diagram, a KaTeX render). One that renders at a stable skeleton size declares `estimateHeight` at that size and the guess is exact; one that truly can't know gets guessed as prose, self-corrects on first mount, and drifts the scrollbar thumb a bit more until then.
- For every scope, the heights live in a binary indexed tree (i.e. Fenwick tree); this allows for things like "what pixel offset does block N start at" and "which block is at pixel P" to be answered in log time.
- Measuring gets batched. Say 30 blocks get mounted - they are measured all at once and written (into the tree) all at once, this way the browser re-lays out once for the whole batch. An edit to a single mounted block re-measures just that block, through the same writer.
- The measured heights are cached (by block id, beside the tree), and that cache is discarded if the whole document is replaced through the `source` prop, or if anything changes how a block renders (smooth transition to next section)

## Keeping the page still while heights change

Here's a bad ux: you scroll up, a block above the viewport gets mounted (thus getting its real measurement), it turns out taller than the guess, and the content under your eyes slides down. So, to not have this, windowing self corrects - it gets the difference (between the measurement and the estimation) from the height model, and adjusts the scroll by the difference.

Again, some technical details:

- By default browsers have their own scroll anchoring (i.e. it also tries to correct for content growing above you), which would double move the reader. Thus, the editor turns the browser's scroll anchoring off where it owns the scrolling (`scrollMode="self"`) and, on a host page, side steps the browser (i.e. withdraws its own subtree from the browser's anchor candidates) during windowing; below the budget it corrects nothing and lets the browser's anchoring do its job. The mode only ever picks which scroller windowing reads (the editor itself, or the nearest scrollable ancestor / the page); whether a scope windows is decided by the budget alone.
  - Do note, while windowing in host mode, something growing in the page's own chrome above the editor goes uncompensated, because the editor's subtree is no longer an anchor candidate.
- Chrome above the block list (the editor's header slot, or the host page's own) needs no special case in the window math: a scope only counts the part of itself that overlaps the viewport. The header slot does need the correction though (its height lives outside the height model), so when it grows, its delta routes through the same scroll adjustment.
- For things that grow after mounting (e.g. an image decoding, a font swapping in, a lazy embed), those have to be accounted for lest we want to cause the dreaded slide; so every rendered block reports its size changes and windowing corrects for that.
- Fun fact: a scope starts windowing when its estimated height clears a budget (a few viewports), and stops when it drops below a _lower_ one. If the two thresholds were the same, a doc that hits the threshold line more or less exactly would flip on and off with every keystroke, and each flip remounts blocks, and that would be bad.
- Unfortunately, the scrollbar thumb (as in the handle of the scrollbar) still drifts during windowing (while guesses are being replaced by measurements), and is the one visual artifact that's not corrected for. Fortunately, it shrinks as more blocks get measured.

## When and how everything re-measures

**Narrow the window and prose rewraps, so every cached height is wrong.**

We drop the measured cache, rebuild each scope's height model, and remeasure the mounted blocks.

**Resize the height only and nothing rewraps.**

The measurements survive; only the slice recomputes, since how many blocks fit comes from the viewport's height.

**Change the font size and every line box moves.**

This is more annoying, the estimations need to update based on the live computed font size (watched on a one-`em` probe, because a font-size change resizes no other box in the root). It then runs the same drop-rebuild-remeasure as the width case. Skip it and the error is systematic: a doc whose real height clears the budget can be guessed under it and never window at all.

**Flip the presentation mode and hidden markers appear or vanish, which rewraps too.**

Drops the measured cache. That's it actually. This way we only account for a little drift instead of a full rebuild.

## Nesting

**Why does aragonite nest windowing?** I don't know who keeps asking these stupid questions, but here goes: because large containers need it, for example a long flat list with thousands of items (i dunno, some people are freaky like that). Each layer only ever sees its own children, so a huge nested list is one entry, one height, in its parent's model, and nobody has to look inside. It's also nice this way, because wiring is just one hook, so a plugin container inherits windowing by declaring only what is different about it (its DOM selectors, where its children come from, etc.).

## Doing something to a block you can't see

Example: undo lands the caret five thousand blocks away, search jumps to the next match, focus moves off the bottom of the window. To account for that, anything that must touch a block's DOM first reveals it: the editor walks its path (remember how absolute indices allow for stable, absolute paths? yeah, this is one of the uses) from the top, scrolling each windowed scope to the target, waiting for that target to mount, rinse and repeat till we finally get to the thing we touch. A level whose target is already mounted (in the window, in the overscan band (the few extra blocks mounted past each edge), or pinned) is skipped for free, so the common short hop resolves in a tick with no scroll.

Sometimes the block can never mount: it lives inside a collapsed `<details>` block, or a guess was off and the scroll missed. Reveal gives up instead of hanging, and that is fine. The document and the selection are data (paths and offsets, remember), the operation already did its real work on them, and only the very last step, putting the browser's caret in a DOM node, needed the block to exist. The caret shows up the next time the block mounts.

Two more things about revealing, for the curious:

- **Holding a target.** A search jump or a navigation has to _keep_ its target on screen, and images above it may still be decoding and shrinking the page under it. So such a reveal claims the reveal anchor: until you scroll, the editor re-pins that target after every round of measuring instead of holding whatever block is at the top. While the claim is live, growth reported up from a nested scope re-pins too (that channel normally corrects nothing, see the known limitation), or content growing inside the target's own container would shove it off screen. Where the browser's anchoring is already holding the reader (host mode, under the windowing budget) the editor writes no scroll at all, claim or no claim. Your own scroll gesture releases it (a gesture, not the `scroll` event, which the correction fires itself). One target at a time (a newer reveal takes the slot, and the superseded one just stops refining instead of fighting), and nested scopes never claim it, because two things fighting over one scroll position is how you get jitter.
- **The pin.** The block you are typing in stays mounted even if you scroll it out of view, so focus and an in-flight IME composition survive. It has a cap: park the caret, scroll a few hundred blocks away, and the pin lets go and focus blurs. Rare, and fine.

## Selection

Selection endpoints are paths and offsets, i.e. data and not DOM, so copy, cut and delete walk the tree, and select-all-then-copy on a huge doc works with only a slice rendered. The highlight paints only on mounted blocks and flows with the viewport as you scroll. The caret end is always mounted (it is pinned, see above); the far end may be off screen and simply isn't painted, because, well, it's off screen. The screen-reader announcement is built from the same selection data, so it doesn't care what is mounted either.

## Tables

A giant table windows its rows the same way. The twist: a table is a CSS grid and a row has no box of its own, so a row's height is read off one of its cells, and the spacers span the whole grid width. Reveal descends row, then cell, so the caret still lands in the right cell of a row nobody has rendered.

## What the commit gate actually checks

Not a timing. It counts mounted blocks: viewport's worth, plus a little overscan, plus the pinned block, no matter how big the document is. Everything outside that set has no component and no ref, and code that touches a block's DOM already null-checks. A count is the same on every machine and every build, so it never flakes, unlike every timing assertion ever written.

## Known limitation

The scroll correction is per scope. If a nested container _above_ your viewport grows after everything settled (and nothing is holding a target), its parent's spacer grows with no one compensating, and you get one jump. It only happens when an off-screen nested container measures in late, and the jump is bounded by how wrong the guess was. On the list.

## The VR tags

Scattered through the windowing code, tests and e2e requirement files you will see things like `(VR-2)` or `pins VR-5`. Those are tags for the windowing hazards this doc has been describing, the same idea as the `G` numbers the invariants carry: a comment at the line that guards against a hazard cites the tag instead of re-explaining the hazard, and this table is where you look it up. So `Do NOT restore overflow-anchor (VR-2)` next to an odd-looking line means "this is deliberate, and here is the one place that says why".

Adding one is simple. Pick the next free number, add a row here that says what the hazard is and what must stay true, then cite it from the comment or test that holds the line. Retiring one: delete the row, leave the number unused; an old citation in git history still means what it meant. (The numbering already skips VR-7, VR-10 and VR-13.) A row nothing cites any more is a row to delete, not to keep for sentiment.

| Tag   | The hazard, and what stays true                                                                                                                                                                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VR-1  | Making the editor narrower rewraps prose, so every measured height is now wrong. The scope drops them and re-measures, and holds the scroll position while it does.                                                                                                                 |
| VR-2  | Jumping into a part of the document that was only ever guessed swaps guesses for real heights mid-render, which would slide the content. The editor's own scroll correction compensates, and the browser's built-in anchoring is off wherever that correction runs, and only there. |
| VR-3  | A nested scope guesses heights at its own content width (a list inside a quote is narrower than the page), never at the width of the whole scrolling area.                                                                                                                          |
| VR-4  | Measuring is batched: a scope reads every newly mounted height before it writes any of them back, so a fast scroll costs one browser layout per frame instead of one per block (and one per table row).                                                                             |
| VR-5  | A reveal whose target can never mount (a collapsed body, a scroll that landed short) gives up instead of waiting forever. The wait is only ever woken by the target itself mounting, never by a timer.                                                                              |
| VR-6  | Anything that decides "is there a block here" reads the document tree, not the array of mounted components, so a windowed document answers exactly like an unwindowed one.                                                                                                          |
| VR-8  | A hard fling can scroll faster than blocks mount, so the spacers paint a faint placeholder tint rather than blank white, and the overscan band is wide enough that you rarely see it.                                                                                               |
| VR-9  | The height model (the Fenwick tree) must survive a read or write outside its range without corrupting itself.                                                                                                                                                                       |
| VR-11 | A scope only counts as "on screen" for the part of it that overlaps the viewport, so several scopes stacked in one viewport mount roughly one viewport's worth of blocks between them, not one each.                                                                                |
| VR-12 | The synchronous focus paths cannot reveal: they do not mount an off-screen block, so a caret sent farther than the overscan band silently goes nowhere. A landing whose distance depends on anything other than the caret's own movement (a paste, say) must reveal first.          |
| VR-14 | A window whose end comes before its start (possible for one tick after a stale derive) collapses to empty rather than producing a slice of negative length.                                                                                                                         |
| VR-K1 | In a row-windowed table, index 0 of the mounted rows is the first _mounted_ row, not row 0 of the table, so column geometry must be read from whichever row is actually mounted.                                                                                                    |
