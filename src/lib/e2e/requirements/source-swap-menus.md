# Feature: A source swap or a mode change closes every open menu

## Edge cases

- The block menu open on a code fence, then a `source` swap: the menu closes, `menuChange` reads
  open then closed, and no action of the old menu runs against the new document
  - Miss-analysis: no spec swapped the document under an open menu, and the swap's own unit pin
    listed the resets it had rather than asking which state still named the old document
- The link card open on a link in live mode, then a swap: the card closes
- The inline menu open on a typed trigger, then a swap: the list closes, and closing it while the
  block holding it unmounts raises no error
- The table menu open from Shift+F10 on a body cell, then a swap: the menu closes and
  `menuChange` reads open then closed
- The code block's overflow menu open in live mode, then a swap: the menu closes

## Mode changes

- The table menu open in source mode, then a switch to reading: the menu closes, `menuChange`
  reads open then closed, and the table's bytes are untouched
  - Miss-analysis: the editor closed its own menus by name on a mode change, and no spec opened a
    menu a block owns before switching, so the table menu stayed open with rows reading mode refuses
- The code block's overflow menu open in live mode, then a switch to reading: the menu closes
  and `menuChange` reads open then closed
- The code block's language picker open in live mode, then a switch to reading: the picker closes
