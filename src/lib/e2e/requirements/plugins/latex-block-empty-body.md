# Feature: emptying a one-line `$$` block's body in live mode (#343)

A `$$x^2$$` block carries its whole formula on the fence line itself, so deleting the body leaves
a source with no body line at all. While the fence lines are hidden, the block holds nothing but
its own fences, and live mode paints markers standing over no content, so the user's equation
turns into `$$$$`. The completion applied when a bare block's source is shown has to hold while
editing too: whatever empties the body, the block ends up as an opener, one empty body line and
a closer, with the caret on that line.

Fixture: `Before` / `$$x^2$$` / `After` (`?seed=mathblock`), in `live`.

## Happy paths

- select all, then Backspace, leaves `$$\n\n$$` with the fence hidden and the caret on the body
  line
- emptying the body key by key (End, then Backspace per byte) ends up in the same shape
- typing into the emptied block starts the formula again, and the blur commits `$$\ny\n$$`

## Edge cases

- the blur after emptying commits `$$\n\n$$`, keeps the kind `mathBlock`, and round-trips
- a second Backspace on the emptied block deletes it, the way an emptied code fence goes
- undo while the source is still open takes the completion back along with the delete that
  caused it

## Miss-analysis

- Every emptying scenario ran on the multi-line seed, whose blank body line survives a clamped
  delete, so the one place the completion happens was never reached from the editing side. The
  one-line `$$x^2$$` form, the only shape with no body line to leave behind, had no live-mode
  scenario.
