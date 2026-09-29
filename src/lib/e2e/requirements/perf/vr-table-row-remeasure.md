# Feature: Virtual rendering, a table row that changes height on its own is measured again

A windowed table remembers each row's height in its height table (the list of
heights its spacers are built from). A row can change height without a byte
of it changing: a tall formula in a cell showing its source instead of its
rendering, say. The row gets measured again when that happens, so its entry is
the row as drawn.

Driven on `/test/plugins` (the route that renders math) in source mode, over a
table long enough to window, each row holding a four-line matrix that shrinks
to one line of source when clicked. The entry is read through
`__test.getHeightOracle()` by the row's id and compared against the row's
first cell, which the grid stretches to the row's height.

Miss-analysis: a row copied the block measuring's mount and edit triggers but
not its resize one, and the only row tests changed a row's bytes, so a row
that resized with its bytes unchanged was never run (issue #546).

## Happy paths

- clicking a row's formula shows its source and the row shrinks by more than
  20px: the row's entry matches its new height within 1px (red before the fix:
  the entry kept the rendered height, 67px too tall)

## Error cases

- no page errors surface during the load or the click
