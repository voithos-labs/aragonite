# Feature: Backspace beside a title row

Backspace after a block that goes whole puts the caret at the end of the block before it. Right
under a `:::` container's title row, that block is the row. Fixture: `:::note`, a `---` rule
focused by ArrowUp from `para`, then `para`, in the `/test/plugins` harness.

## Happy paths

- A row with a title (`:::note Title`): Backspace on the rule lands at the title's end in both
  modes, and a typed `x` gives `Titlex`
- A row with no title, live mode: the row's end is the end of `:::note`, which live mode hides.
  Backspace lands where Delete does, at the start of `para`, and `x` gives `xpara`
- The harness's own `:::callout` container with no title lands the same way, in each mode
- A row with no title, source mode: `:::note` shows as text, the caret lands after it, and `x`
  types there (`:::notex`), as a caret placed there types

## Miss-analysis

- Backspace beside a title row was only typed into under rows with a title, where the row's end is
  the title's, so no row put a letter into a hidden name.
