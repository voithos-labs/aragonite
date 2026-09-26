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

## Error cases

- no dev warning or captured error across the extension and the delete

## Miss-analysis

- Every extension scenario crossed open containers, so the extension's step into a hidden body,
  and the reveal that then opened the block to mount it (#562), had nothing that could see it.
