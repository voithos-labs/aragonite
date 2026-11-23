# Feature: A math block's layout toggle, and the room it keeps

An open math block shows its source beside a live preview (`split`), above it (`stacked`) or
alone (`source`). The toggle in the top-right card cycles the three, and the block keeps a code
block's room above and below in every one of them. Driven with the mouse on both fence forms,
`$$` and ` ```math `.

## Happy paths

- A click on the toggle while the source is open cycles split, stacked, source and back to split
- The block's host sits 6px outside the equation's own box, above and below, folded and open

## User interactions

- A toggle click with the source focused and a letter typed keeps the caret in the source, the
  letter in the shown text, the document's bytes and the undo stack's depth as they were
- Leaving the source after the cycle writes the letter once, as one undo step

## Miss-analysis

No row toggled the layout: the toggle's own `mousedown` keeps the source focused, and nothing
held that a click on it neither commits the source nor closes it.
