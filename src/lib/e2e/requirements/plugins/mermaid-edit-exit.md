# Feature: Mermaid edit box — boundary arrow exits

The diagram's edit box is a plugin-owned textarea, and a textarea swallows every arrow key at
its own boundaries. Every other editing surface in this editor hands the caret to the next
block when an arrow runs off its edge, so the box owes the same: ArrowUp on the first line and
ArrowLeft at offset 0 leave upward, ArrowDown on the last line and ArrowRight at the end leave
downward. An empty diagram makes the omission a trap rather than an annoyance — its edit
surface IS its view, the caret lands there typing-ready, and without an arrow exit only the
mouse can leave.

Lines are logical (newline positions around the caret), not visual: a plugin surface exposes no
editor caret geometry, so a wrapped row does not count as a line boundary.

## Happy paths

- An empty diagram between two paragraphs: the caret lands in its box, ArrowUp reaches the
  paragraph above and ArrowDown reaches the one below; the block stays, still showing its box
- ArrowUp on the first line of a non-empty box exits upward AND commits the draft, exactly as
  clicking away does — `getSource()` carries the edited code
- ArrowRight with the caret at the end of the box exits downward, ArrowLeft at offset 0 upward

## Edge cases

- Mid-text arrows stay native: with the caret on the second line, ArrowUp moves within the box
  and the caret stays in it (non-vacuity for the exit above)
- A selection-extending arrow stays native: Shift+ArrowUp on the first line extends inside the
  box, leaves the caret in it, and commits nothing
- Escape in an empty diagram's box is not the exit — the box is the block's only view, so the
  cancel keeps the box and the caret; leaving is the arrow's job

## Miss-analysis

The empty-state battery asserted that the caret LANDS in the box (typing-ready, no error card)
and never that it can leave; the mermaid edit-flow specs left the box by Ctrl+Enter, Escape or
a click, all of which the plugin already handled. No test pressed a bare arrow inside the box,
so the textarea's native boundary swallow was invisible at every tier.
