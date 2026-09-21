# Feature: the gap caret's surface

What the between-blocks caret looks like, and every way out of it that creates nothing.
Arrival is in `gap-caret-arrival.md`; creating a paragraph and undoing it are in
`gap-caret-editing.md`.

## Happy paths

- A live gap paints a horizontal line across the content column at the boundary: 2px tall,
  visible, coloured from the editor's text token so it reads as a caret in both palettes.
- No gap, no line: nothing is painted while the caret lives in a block.
- The line adds no layout. The block below the boundary sits at exactly the same position
  whether or not a gap caret sits above it: the wrapper is zero-height and the line is
  positioned out of flow.
- Shift+ArrowDown and Shift+ArrowUp leave the gap exactly as the plain arrows do, entering no
  selection.
- A shift-click into a block while a gap is live lands the caret like a plain click.
- Focus leaving the editor root entirely clears the gap.
- Once an arrival finishes, a `selectionChange` subscriber has been told the caret left: the
  last emission is null and `getSelection()` reports null. The gap is outside the public
  `SelectionPoint` union, so null is how it appears to a consumer.

## Edge cases

- Switching the presentation mode to reading while a gap is live clears it, and switching
  back does not bring it back (#88).
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
- **The reading-mode DOM assertion proves nothing on its own.** Once the gap is cleared at
  the one place every path goes through, no proxy renders at all, so "no `[data-gap-caret]`
  is contenteditable" holds whether or not the component's own reading-mode check exists.
  The spec switches the mode through the harness's own call precisely because a toggle click
  blurs the proxy and `onFocusOut` clears the gap before that shared clear runs; switched
  that way, deleting the shared clear goes red. The component's own check is the belt no
  test pins.
- Window blur (a `relatedTarget` of `null`) keeps the gap, matching a native caret.
- **An arrival emits `selectionChange` more than once.** The state write fires while DOM
  focus is still in the source block, so it reports that block; the proxy's own range brings
  the stream to null a moment later. Suppressing the second emission leaves subscribers
  reading the stale block position, so the final value is the contract and the sequence of
  emissions is not.

## Miss analysis

#88, a gap surviving the switch into reading mode, is the class _editor-owned state that
outlives a mode switch_. The test that should have caught it is a sweep over every live
editor-owned state (cross-block range, widget selection, search, gap) across a mode switch,
asserting each one clears; none existed, because every earlier state cleared through the DOM
blur the switch already performed, and the gap is the first one no blur can reach. The
general rule is that a new editor-owned caret state joins the mode-switch clear in
`Editor.svelte`, rather than each arrival path checking the mode.
