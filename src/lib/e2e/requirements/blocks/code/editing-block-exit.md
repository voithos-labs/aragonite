# Feature: Code Block Navigation Exit

Leaving a fenced code block via Enter-on-empty-line, a typed closer there, vertical arrow keys,
or Backspace-at-start.

## Edge cases

- exit code block via Enter on empty trailing line: press Enter on an empty last line — exits to a new paragraph after the code block
- exit code block by typing the closer on the empty trailing line: three backticks typed there are the exit, not body text — the run is never written, the fence keeps its own length, and the caret lands in a new paragraph after the block
- ArrowUp in first line exits to previous block: cursor in first line, ArrowUp moves focus above the code block
- ArrowDown in last line exits to next block: cursor in last line, ArrowDown moves focus below
- Backspace at position 0 moves focus to previous block: does not delete the code block; the typed marker afterward lands at the end of the previous block, proving focus moved without corrupting the fence
- Backspace immediately after opener fence edits nothing: caret at the start of the body's first column (just past the opener's `\n`) — Backspace must not delete the boundary newline (which would fuse the body into the opener line). The fence leads the document, so the focus exit parks in the start gap (requirements/selection/gap-caret-arrival.md)
- Delete immediately before closer fence is a no-op: caret at the end of the body's last column (just before the closer's leading `\n`) — Delete must not consume the boundary newline (which would shift the closer off column 0)
- Backspace inside info string trims the info string: counter-test confirming the boundary guard fires only at the two `\n` boundaries, not anywhere inside the opener line
- Backspace at position 0 of indented code moves focus without deleting: sibling not-mergeable kind shares the focus-only exit semantics
- Backspace at position 0 of html block moves focus without deleting: sibling not-mergeable kind shares the focus-only exit semantics

## Miss-analysis

- Exiting a code block was only ever asked of Enter, so the other thing a writer does at the end
  of one — typing the closer — reached the write seam instead, where a body line that reads as the
  closer can only mean "grow the fence".
