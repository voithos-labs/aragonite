# Feature: Enter inside a revealed inline source

Enter is the block's split key everywhere else in the editor, and the reveal used to claim it as a commit gesture. That cost the user the press twice over: at a source edge it moved the caret past the widget instead of pushing content down, and on a source already broken into plain text it did nothing visible, so the split needed a second press. Enter now commits the ephemeral edit AND splits at the caret, riding the fold seam (`latex-inline-reveal-commands.md`). Escape remains the reveal's only claimed key.

A table cell is the deliberate exception, pinned with the cell (`blocks/table/cell-inline-reveal.md`): a cell's Enter is a row hop, and hopping would carry the ephemeral edit out of the surface that owns it, so there Enter commits and the caret stays put.

## Happy paths

- Enter at the leading edge of a revealed source splits the block there: the content moves down and the caret stays BEFORE the math, not past it
- Enter after the revealed source has been broken into plain text splits on the FIRST press
- Enter mid-source commits the ephemeral edit as it splits — the edit is not discarded by the structural op

## User interactions

- Real keyboard only: caret entry against the widget's edge to reveal, real typing into the revealed source, real Enter. The caret is asserted by typing a marker character, never by reading the source, which is correct wherever focus landed.

## Error cases

- No `[invariant:…]` fire and no page error across reveal → edit → Enter
