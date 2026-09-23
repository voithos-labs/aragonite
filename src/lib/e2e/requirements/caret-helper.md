# Harness: the page object's caret helpers

`focusBlockStart`, `focusBlockEnd` and `focusBlock` set up most specs, so the caret they leave
must be one the editor itself places. A caret anchored on the block element past its last child
is a position no click or key produces, and a spec can pass on it for the wrong reason.

## Happy paths

- focusBlockEnd on a paragraph with inline markers: the caret sits in the last text node at its end, and the editor reads the raw content end
- focusBlockStart: the caret sits in the first text node at offset 0
- focusBlock with a number: the number is a raw offset, and the caret lands on a text node there

## Edge cases

- a list block: start lands in the first item's paragraph, end in the last item's paragraph, both read back by the editor
- a table: start lands in the first header cell, end at the end of the last cell
