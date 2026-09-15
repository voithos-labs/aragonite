# Feature: editing a whole-block range that opens with an inline widget

An edit key aimed at a held range edits the range. The caret the edge dispatch reads is that
range's start, so a block whose first inline node is an atomic island must behave exactly like one
that opens with prose: the character replaces the selection, Delete empties it.

Miss-analysis: every ranged-edit test selected a range starting on prose, and every widget-edge
test pressed its key at a collapsed caret, so no test ever crossed the two and the caret arms that
answer for the construct beside the range's start were never asked a ranged question.

## Happy paths

- Ctrl+A then a character, paragraph opening on `$x^2$`: the source becomes the character alone.
- Triple-click then a character on the same paragraph: same replacement.
- Ctrl+A then a character, paragraph opening on a `:smile:` glyph: same replacement.

## Edge cases

- Both presentation modes: source and live paint the leading island differently, and the rule is
  the same in each.
- Ctrl+A then Delete on a widget-led paragraph: the whole block empties, never just the widget.
- Ctrl+A then Delete on a glyph-led paragraph, whose kind deletes atomically at a caret: the range
  still wins, so the rest of the selection cannot survive its widget.

## User interactions

- One undo after the replacement restores the original bytes, so the replacement landed as a
  single commit rather than a delete plus an insert.
