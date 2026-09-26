# Feature: Editing a code block's fence lines where the mode paints them

A code block's fence lines (the opening ` ```js ` line and the closing ` ``` ` line) are editable
text wherever the mode paints them: always in source mode, and on the focused block in the
preview modes. A caret arriving from another block still lands in the body; a click or an arrow
inside the block reaches the fence lines.

One stray keystroke on a fence line can break the fence: a closer that stops matching leaves the
block open, and an opener that stops matching strands the closer, which then opens a fence over
everything below. So every edit here goes through the fence write rule, which keeps exactly one
opener line and one closer line, and the block after the code block always stays its own.

Where the mode hides the fence lines, edits clamp to the body instead: `fence-ranged-edit.md`.

## Happy paths

- a selection inside the info string is edited verbatim: typing over `js` writes `py`
- a delete from the body into the closer lands; the closer comes back on a line of its own, the
  paragraph below stays a paragraph, and undo restores the block byte-for-byte

## Edge cases

- Backspace inside the closer run: the shortened run becomes a body line and a full closer
  follows it, so the block stays closed
- Backspace inside the opener run: the block demotes to a paragraph and the closer goes with
  it, so nothing below is absorbed
- paste over the closer: the pasted text lands and a closer follows it
- an unclosed fence has no closer to strand, so deleting its marker run turns it back into a
  paragraph, byte-for-byte: that's how a just-typed ` ``` ` is taken back

## User interactions

- ArrowUp from the body's first line reaches the opener; End and a typed character extend the
  info string (`js` becomes `jsx`)
- the preview modes take the same edit on the focused block, where they paint its fence lines
  (miss-analysis: every fence edit test ran in source mode against a clamp that held in every
  mode, and no test ever put an edit on a painted fence line)
