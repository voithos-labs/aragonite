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

## Edge cases

- a delete of the grown range removes the whole details block, its hidden body included, and
  joins the blocks on either side as for any other covered block
- a range whose moving end stops on the title row covers the hidden body too: Backspace there
  removes the whole block, and a typed character lands where the range's other end was
- Shift+Mod+End from the top of a document ending in a closed details stops on its title row,
  and Backspace then empties the document, hidden body included
- an open details keeps its wall: a range from its title row into the block below empties it to
  its title row, and the tree left behind is the one a reload of the bytes reads back (#605)

## Error cases

- no dev warning or captured error across the extension and the delete

## Miss-analysis

- Every extension scenario crossed open containers, so the extension's step into a hidden body,
  and the reveal that then opened the block to mount it (#562), had nothing that could see it.
- The first version of this spec grew the range past the title row before deleting, so no test
  deleted a range that ended on the row, and the kept body under an emptied title (#601) passed.
