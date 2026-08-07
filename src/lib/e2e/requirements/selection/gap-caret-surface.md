# Feature: the gap caret's surface

What the between-blocks caret LOOKS like, and every way out of it that is not a mint.
Arrival is `gap-caret-arrival.md`; minting and undo are `gap-caret-editing.md`.

## Happy paths

- A live gap paints a horizontal line across the content column at the boundary: 2px tall,
  visible, coloured from the editor's text token so it reads as a caret in both palettes.
- No gap, no line: nothing is painted while the caret lives in a block.
- The line adds no layout. The block below the boundary sits at exactly the same position
  whether or not a gap is parked above it — the wrapper is zero-height and the line is
  positioned out of flow.
- Shift+ArrowDown and Shift+ArrowUp leave the gap exactly as the plain arrows do, entering no
  selection.
- A shift-click into a block while a gap is live lands the caret like a plain click.
- Focus leaving the editor root entirely clears the gap.
- Once an arrival settles, a `selectionChange` subscriber has been told the caret left: the
  last emission is null and `getSelection()` reports null. The gap is outside the public
  `SelectionPoint` union, so null is how it appears to a consumer.

## Edge cases

- Flipping the presentation mode to reading while a gap is live clears it, and flipping back
  does not resurrect it (#88).
- The blink is a `step-end` animation matching the native caret cadence, and
  `prefers-reduced-motion: reduce` leaves the line static rather than hidden. Not asserted:
  a blinking element's computed opacity is a coin flip, so the paint check reads box,
  visibility and colour instead.

## User interactions

- Shift+Arrow, shift-click, focus moves, and the demo harness's presentation toggle. No
  programmatic state writes.

## Known v1 narrowings

- **Shift+Arrow is the plain arrow.** Selecting the neighbouring block whole was cut: a
  single block selected whole is not a representable cross-block state, and the per-kind
  shapes it would need (cell range, native range, focus highlight) would put kind dispatch
  back into selection code.
- **The reading-mode DOM assertion is not discriminating on its own.** Once the gap is
  cleared at the choke point, no proxy renders at all, so "no `[data-gap-caret]` is
  contenteditable" holds whether or not the component's own reading-mode guard exists. The
  choke point in `Editor.svelte`'s mode-flip effect is the load-bearing half; the component
  guard is the belt.
- Window blur (a `relatedTarget` of `null`) KEEPS the gap, matching a native caret.
- **An arrival emits `selectionChange` more than once.** The state write fires while DOM
  focus is still in the source block, so it reports that block; the proxy's own range
  settles the stream to null a moment later. Suppressing the second emission was tried and
  reverted — it leaves subscribers reading the stale block position. The settled value is
  the contract; the burst shape is not.

## Miss analysis

#88 — a gap surviving the flip into reading mode — is the class _editor-owned state that
outlives a mode flip_. The test that should have caught it is a mode-flip sweep over every
live editor-owned state (cross-block range, widget selection, search, gap), asserting each
folds; none existed, because every earlier state folded through the DOM blur the flip
already performed, and the gap is the first one no blur can reach. The generalized guard is
that a new editor-owned caret state joins the mode-flip choke point in `Editor.svelte`, not
that each arrival path checks the mode.
