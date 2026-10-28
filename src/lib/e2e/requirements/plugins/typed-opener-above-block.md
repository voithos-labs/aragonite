# Feature: an opener typed above a finished block leaves it whole

A line that is only `$$`, or only `:::name`, reads as a paragraph until a line below closes it, and
the first such line below is usually the opener of the next block of the same family. Typed into an
empty paragraph above one, the opener would take in every block down to it and break that block
apart. So the keystroke either writes no opener, or the opener gets its own closer as it is
written, the way a typed fence does. Driven on `/test/plugins?seed=math` with real keys, in source
and live mode, above a math block and above a directive block; each row reads the bytes, the kind
of the last block and whether the tree reloads as itself.

Loading the same bytes is a different matter: a file with a lone `$$` above a math block reads the
two as one block, because that is what the grammar says, and the editor shows it that way too.
Nothing here changes how bytes load.

Miss-analysis (#800): the typed-formation rows typed `$` and `$$` into documents with nothing
math-shaped below, the closer rows typed closers under a loaded open opener, and the fence rows
that typed an opener above a finished block covered fences only, so no row typed an opener that
reads as a paragraph above a finished block whose own first line could close it.

## Happy paths

- A lone `$` above either block types `$` alone, not the pair: the next letter lands after it,
  and the block below keeps its bytes and its kind
- `$x$` above either block is inline math, and a space typed after it lands outside the formula
- `$$` above either block is a math block of its own around an empty line, with the caret on that
  line: a letter typed there and a blur write `$$\ny\n$$`, and the block below is untouched
- `:::note` typed above a math block stays a paragraph, since nothing below could close it
- `:::note` typed above a directive block closes at its first letter (`:::n` writes `:::n\n:::`)
  with the caret on the opener line at 4. The rest of the name lands on that line too: the caret
  ends at 7, the container is an admonition, and the block below stays its own

## Edge cases

- One undo after `$$` and a blur takes the second `$` back, leaving `$` with the caret after it
- A lone `$` in a list item or a quote, above a math block, types alone too

## User interactions

- a caret placed by the editor's own selection call, then typed characters and Mod+Z through
  the browser

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
