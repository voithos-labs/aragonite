# Feature: A source swap closes every open menu

## Edge cases

- The block menu open on a code fence, then a `source` swap: the menu closes, `menuChange` reads
  open then closed, and no action of the old menu runs against the new document
  - Miss-analysis: no spec swapped the document under an open menu, and the swap's own unit pin
    listed the resets it had rather than asking which state still named the old document
- The link card open on a link in live mode, then a swap: the card closes
- The inline menu open on a typed trigger, then a swap: the list closes, and closing it while the
  block holding it unmounts raises no error
