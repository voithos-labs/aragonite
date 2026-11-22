# Feature: a caret typed into a widget that can show its source

Typing a widget's opening byte in front of text that completes it (`#` before `few`, `[` before
`^a]`) closes a widget around the caret. A widget whose kind can show its source opens that source
with the caret where it was, one past the typed byte, instead of being pushed past the new widget.
Keys typed in a shown source are written as they land, so a key that stops the bytes reading as
the widget (the Space after `#`) re-parses the block at once. The kinds here are every one
that shows its source with no content span: the harness tag (limestone's registration,
value for value), the footnote reference, the harness wikilink and the inline directive.

## Happy paths

- For each kind, in source and live mode: typing the opening byte before an existing body leaves
  the caret one past it, the bytes hold the completed construct, and the block shows its source,
  not a rendered widget, still after the render settles.
- `#`, `##` or `###` then Space before `few words here`, in source and live mode: the block is a
  heading on the Space, with no End or click, and the caret sits after the space.

## Edge cases

- Space after a mid-line `#few` (`text #few words`): the line stays a paragraph, so the source
  stays shown over `# few` until the caret leaves it, and End closes it.
- Inline math typed through a state that is not math (`$x$`, then Space, then `y`, in live mode):
  the source stays shown and tinted at `$x $` and `$x y$`, with no change of look, and the formula
  renders once the caret leaves.
- Backspace on the space of `# few words here` turns the heading back into a paragraph opening
  with the tag `#few`: the caret stays at 1, inside the tag, with its source shown; Ctrl+Z then
  puts the heading back with the caret at 2, where the Backspace began.
- Undo of a burst typed inside a tag's shown source puts the caret back at the byte the burst
  began, with the source shown, and redo puts the bytes back.
- The editor's `setSelection` to raw 2 inside `#few` puts the caret at 2 with the source shown, the
  same route undo and redo restore their caret through.
- Backspace at the start of `few words`, below a block ending `tag #`, joins them into `#few`: the
  caret stays at the join, inside the tag with its source shown, and the next letter types there.
- A paste inside a shown tag source leaves the caret after the pasted text, so the next letter
  follows it. Miss-analysis: the clipboard rows pasted at a formula's edge, where the caret a
  rebuild carries never falls inside a widget, so none saw that caret open the source at its old
  offset and swallow the paste's own.
- A menu trigger typed inside a shown source opens no inline menu, even where the bytes have
  stopped reading as the widget (`$ @x$`).

## User interactions

- In a table cell, `#` typed at the start of `few` leaves the caret at 1 with the source shown, as
  in a paragraph.
- In a table cell holding `#few`, `setSelection` to raw 2 opens the tag's source there; a burst
  typed in it undoes with the caret back at 2 and the source shown, and redo puts the bytes back.

## Error cases

- no `[invariant:…]` console messages, the caret landing check (G1.115) included

## Miss-analysis

- Every tag test typed a tag at a line's end (` #fresh`), so no row typed an opening byte in front
  of a body that completes it, and no row covered a widget kind with `revealSource` but no content
  span: latex, the one kind with a span, hid the gap. The heading then formed only when the source
  closed, because a shown source held its keys out of the document, and no row typed a key that
  changes the block's kind inside one.
