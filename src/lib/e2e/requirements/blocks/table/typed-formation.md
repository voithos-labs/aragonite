# Feature: Typing a table into existence

A table needs a header line and a delimiter line adjacent, which Enter alone can never produce:
it always mints a blank-line-separated block, because two adjacent prose lines are one paragraph.
The split command's Enter-completion arm closes that: a paragraph whose whole raw is one
header-shaped row, with the caret at its end, is replaced by the finished table instead of split.

## Happy paths

- Type `| a | b |` into an empty paragraph and press Enter: the block becomes a table carrying the
  typed header, a canonical delimiter row and one empty body row, and the press mints nothing else
- The caret lands in the FIRST BODY cell, proven by typing a character and reading which cell holds it
- Cell content is preserved verbatim and re-padded canonically: `|a|b|` completes to `| a | b |`
- A header row typed below an existing table forms its own table; the blank line between them
  survives, so a reload still sees two

## Edge cases

- One Mod+Z restores the paragraph byte-for-byte with the caret back at the end of the typed line;
  a character typed after the undo lands after the final `|`, not in front of the row
- Enter again after that undo completes again. Re-completion on the restored line is intended: the
  user who wanted a literal pipe paragraph undoes once and moves on (escaped `\|` keeps pipes literal)
- A single-cell row (`|a|`) falls through to the ordinary split, since the table scan would not accept it
  as a two-column header
- A row without a leading pipe (`a | b`) falls through. The parser's scan alone would take it, so
  the leading pipe is the intent gate that keeps prose carrying a pipe (`ls | grep foo`) from
  becoming a table
- An escaped pipe inside a cell (`| a \| x | b |`) stays cell content, so the row completes with
  two columns, not three

## Presentation modes

- Live mode: the same press mints the same table, the caret reaches a real cell, and a typed
  character lands in it, with no `[invariant:…]` fire (G1.33 rides the shared fixture)
- Reading mode: Enter changes nothing; the paragraph's bytes are untouched

## Miss-analysis

No test could have caught this: no suite exercised Enter at the end of a lone table-header line at
all, because block formation was only ever tested through the paths that already worked (typed
single-line openers, and multi-line constructs arriving by paste or by load). The generalized
answer is that a construct whose grammar spans adjacent lines has no typed-entry path unless one is
built, and nothing asserted that class of grammar was reachable by typing.
