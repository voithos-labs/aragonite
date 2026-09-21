# Feature: Mermaid edit box: the arrow keys leave at its edges

The diagram's edit box is a textarea the plugin owns, and a textarea swallows every arrow key at
its own edges. Every other editable area in this editor hands the caret to the next block when
an arrow runs off its edge, so the box has to do the same: ArrowUp on the first line and
ArrowLeft at offset 0 leave upward, ArrowDown on the last line and ArrowRight at the end leave
downward. An empty diagram turns the omission from an annoyance into a trap, since its edit box
is its view, the caret lands there ready to type, and without an arrow out only the mouse can
leave.

Lines here are logical, counted from the newlines around the caret, rather than visual: a
plugin's own area exposes no caret geometry to the editor, so a wrapped row does not count as a
line boundary.

## Happy paths

- An empty diagram between two paragraphs: the caret lands in its box, ArrowUp reaches the
  paragraph above and ArrowDown the one below, and the block stays, still showing its box
- ArrowUp on the first line of a box with content leaves upward and commits the draft, exactly
  as clicking away does, so `getSource()` carries the edited code
- ArrowRight with the caret at the end of the box leaves downward, and ArrowLeft at offset 0
  leaves upward

## Edge cases

- Arrows in the middle of the text behave as the browser's: with the caret on the second line,
  ArrowUp moves within the box and the caret stays in it, which is what keeps the exit above
  from passing for want of anything happening
- An arrow that extends a selection behaves as the browser's too: Shift+ArrowUp on the first
  line extends inside the box, leaves the caret in it, and commits nothing
- Escape in an empty diagram's box is not the way out: the box is the block's only view, so
  cancelling keeps the box and the caret, and leaving is the arrow's job

## Miss-analysis

The empty-state battery asserted that the caret lands in the box, ready to type and with no
error card, and never that it can leave; the mermaid edit-flow specs left the box with
Ctrl+Enter, Escape or a click, all of which the plugin already handled. No test pressed a bare
arrow inside the box, so the textarea swallowing it at its own edge was invisible at every
level.
