# Feature: Typing a table into existence

A table needs a header line and a delimiter line next to each other, which Enter alone can never
produce: it always creates a block separated by a blank line, because two adjacent prose lines are
one paragraph. The Enter-completion case of the split command closes that gap: a paragraph whose
whole raw is one header-shaped row, with the caret at its end, is replaced by the finished table
instead of being split.

## Happy paths

- Type `| a | b |` into an empty paragraph and press Enter: the block becomes a table carrying the
  typed header, a canonical delimiter row and one empty body row, and the press creates nothing else
- The caret lands in the first body cell, proven by typing a character and reading which cell holds it
- Cell content is preserved verbatim and re-padded canonically: `|a|b|` completes to `| a | b |`
- A header row typed below an existing table forms its own table; the blank line between them
  survives, so a reload still sees two
- A header row typed inside a blockquote completes in place: the container's rebuild prefixes all
  three lines, and the caret still reaches the body cell (the container resolves its own references)
- A header row typed inside a list item completes in place too. Completion wins over the item's own
  Enter, which would otherwise append a sibling item; a line no completer takes still appends one

## Edge cases

- One Mod+Z restores the paragraph byte-for-byte with the caret back at the end of the typed line;
  a character typed after the undo lands after the final `|`, not in front of the row
- Enter again after that undo completes again. Completing a second time on the restored line is
  intended: a user who wanted a literal pipe paragraph undoes once and moves on (an escaped `\|`
  keeps pipes literal)
- A single-cell row (`|a|`) falls through to the ordinary split, since the table scan would not accept it
  as a two-column header
- A row without a leading pipe (`a | b`) falls through. The parser's scan alone would take it, so
  the leading pipe is what says the user meant a table, and keeps prose carrying a pipe
  (`ls | grep foo`) from becoming one
- Miss-analysis: the interim hard-break branch read every trailing backslash as a break waiting to happen, so the `|` typed after `\` opened a new line; no unit case typed punctuation after a backslash, and this row was the only spec that did.
- An escaped pipe inside a cell (`| a \| x | b |`) stays cell content, so the row completes with
  two columns, not three

## Presentation modes

- Live mode: the same press makes the same table, the caret reaches a real cell, and a typed
  character lands in it, with no `[invariant:…]` fire (G1.33 rides the shared fixture)
- Reading mode: Enter changes nothing; the paragraph's bytes are untouched

## Miss-analysis

No test could have caught this: no suite exercised Enter at the end of a lone table-header line at
all, because block formation was only ever tested through the paths that already worked (typed
single-line openers, and multi-line constructs arriving by paste or by load). The general answer is
that a construct whose grammar spans adjacent lines has no way in by typing unless one is built,
and nothing checked that this class of grammar was reachable by typing.
