# Feature: Plugin Container, Extending a Selection Past a Closed `<details>`

A closed details shows only its title row, so a Shift+Arrow extension that crosses it stops on
that row and never opens the block. The range still covers the hidden body in document order, so
deleting it takes the body with the rest. Every gesture here is a real keypress, read back from
the editor's selection and the serialized bytes.

## Happy paths

- Shift+ArrowUp from below: with a paragraph between the caret and a closed details, the second
  press puts the range's moving end at the title row's start, the third at the start of the block
  above; the bytes, the undo depth and the mounted body count are unchanged, and no edit fires
- Shift+ArrowDown from above: the first press puts the moving end at the title row's start and the
  second at the start of the block below, with nothing written on the way

- Select-all twice over a document ending in a closed details, then ArrowRight: the caret lands at
  the end of the title row, and the bytes, the undo depth and the mounted body count don't move
- A closed details first and a paragraph below it, caret at the paragraph's start: two
  Shift+ArrowUp presses stop the moving end on the title row (the second finds nothing earlier)
  and open nothing

## Edge cases

- an undo whose stored range ends in the hidden body (select-all twice, Backspace, undo) puts the
  bytes back closed and parks the caret on the title row, instead of opening the block to reach
  the body

- a delete of the grown range removes the whole details block, its hidden body included, and
  joins the blocks on either side as for any other covered block
- a range whose moving end stops on the title row covers the hidden body too: Backspace there
  removes the whole block, and a typed character lands where the range's other end was
- Ctrl+X over a range from mid-paragraph onto a closed title row (Shift+Mod+End, which stops past
  the row's first character) cuts the whole details, and pasting it below brings the block back
  with its hidden body. The copy takes exactly what the delete takes (#636)
  - Miss-analysis: the copy and the delete were tested apart, and no test cut a closed details,
    so a clipboard holding a bare title with no body never showed up
- Shift+Mod+End from the top of a document ending in a closed details stops on its title row,
  and Backspace then empties the document, hidden body included
- an open details keeps its wall: a range from its title row into the block below empties it to
  its title row, and the tree left behind is the one a reload of the bytes reads back (#605)

## Error cases

- no dev warning or captured error across the extension and the delete

## Miss-analysis

- Every extension scenario crossed open containers, so the extension's step into a hidden body,
  and the reveal that then opened the block to mount it (#562), had nothing that could see it.
- The collapse, the lone-details press and the undo each reached the hidden body through a
  different route (the collapse's own mount, the extend's caret park, the history restore), and
  every scenario here only extended, so the three routes that opened the block went untested.
- The first version of this spec grew the range past the title row before deleting, so no test
  deleted a range that ended on the row, and the kept body under an emptied title (#601) passed.
