# Feature: the right-click menu's Cut and Copy

The right-click menu over a selection offers Cut and Copy, and they do exactly what Ctrl+X and
Ctrl+C do for that selection. The menu fires the browser's own cut or copy (a scripted
`execCommand`), which reads the clipboard data the moment the event's handlers return, so a cut
has to write its payload during the event, before it waits on anything.

## Happy paths

- Select four characters of a paragraph with Shift+ArrowRight, right-click inside the selection,
  Cut: the clipboard holds those four characters and the paragraph loses them
- The same in a code block's body
- Copy from the same menu, in a paragraph and in a code block: the clipboard holds the selection
  and the document is unchanged

## Miss-analysis

- The menu's Cut put nothing on the clipboard: the cut wrote its payload after waiting for a
  shown source to hide, and by then a scripted cut's data was closed. The cut tests all pressed
  Ctrl+X, where the browser waits for those few awaits before reading the data, and no test drove
  the menu's Cut outside a table cell, whose menu did its own copy and delete.
