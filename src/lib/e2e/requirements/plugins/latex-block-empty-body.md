# Feature: emptying a one-line `$$` block's body in live mode (#343)

A `$$x^2$$` block carries its whole formula on the fence line itself, so deleting the body leaves
a source with no body line at all. While the fence lines hide, that surface holds nothing but its
own chrome, and live mode paints chrome standing over no content, so the reader's equation turns
into `$$$$`. The bare-source completion the reveal door applies has to hold across editing too:
whatever empties the body, the block settles on opener, one empty body line, closer, with the
caret on that line.

Fixture: `Before` / `$$x^2$$` / `After` (`?seed=mathblock`), in `live`.

## Happy paths

- select-all then Backspace leaves `$$\n\n$$` with the fence hidden and the caret on the body line
- emptying the body key by key (End, then Backspace per byte) settles on the same shape
- typing into the emptied block resumes the formula, and the blur commits `$$\ny\n$$`

## Edge cases

- the blur after emptying commits `$$\n\n$$`, keeps the kind `mathBlock`, and round-trips
- a second Backspace on the emptied block deletes it, the way an emptied code fence goes
- undo inside the open reveal takes the completion back with the delete that provoked it

## Miss-analysis

- Every emptying scenario ran on the multi-line seed, whose blank body line survives a clamped
  delete, so the completion's one door was never exercised from the edit side; the one-line
  `$$x^2$$` form, the only shape with no body line to leave behind, had no live-mode scenario.
