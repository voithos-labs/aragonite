# Feature: Virtual rendering, changes to a document below the windowing threshold

A block list decides whether to window from the children a change hands it, in the
same render pass. A document that stays below the threshold therefore renders every
block on every pass, and a block the change did not touch keeps its element.

## Edge cases

- Enter mid-document in thirty paragraphs with an image as the last block: exactly one
  block host is added, none is removed, and the image is the same element as before.
- Enter at the end of the second item of a five-item list: exactly one block host is
  added, none is removed, and the last item is the same element as before.
- A paste of forty paragraphs above that image: the image is the same element as before
  and the document stays unwindowed. Forty is more than any fixed growth allowance a
  slice could grant, so a slice that only tolerates small growth fails here.
- Swapping in thirty paragraphs, from a one-block document or from a windowed
  multi-thousand-block one: every block is mounted, there are no spacers, and the last
  block scrolls into view at the bottom.

Miss-analysis: no test edited an unwindowed document and read the last block's
identity, and the perf rows insert no blocks, so a slice that dropped the last block
for one pass after every insertion stayed green.
