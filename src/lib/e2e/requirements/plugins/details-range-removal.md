# Feature: A selection out of a closed details block

A closed `<details>` hides its body, so a selection can't hold half of it: one that runs out of
the summary holds the whole block. Deleting, cutting or typing over that selection takes what a
copy of it takes, hidden body included. Fixture: a closed details (`Sum`, a hidden `body`), then
`para`, in the `/test/plugins` harness. The selection is a click at the summary's end, then
Shift+ArrowRight, which ends it at the start of `para`.

## Happy paths

- Backspace, Delete or Mod+X takes the details whole and leaves `para`; a letter typed next joins
  it (`xpara`). Source and live mode alike
- Mod+C puts the details on the clipboard byte for byte, hidden body included
- A letter typed over the selection leaves no part of the details: the letter, then `para`
- One undo puts the details back

## Edge cases

- Inside a `:::note` with no title, live mode: Backspace leaves the note holding `para`, and a
  letter joins `para` instead of going into the hidden name. Enter opens a line above `para`
- A selection from a paragraph across an open details or a `:::note` to a heading's start takes the
  container whole, closing line included, and leaves the heading alone
- A selection out of an open summary keeps the details: the selected text and the body go
- A selection from a paragraph to the start of an open details' first block takes the summary's
  text and keeps its tags and the details: the summary is the one block it holds whole

## Miss-analysis

- The copy and the delete read their bytes from one place, so the range laws, which compare the
  two, agreed with a range that was wrong for both. No row selected out of a closed summary.
