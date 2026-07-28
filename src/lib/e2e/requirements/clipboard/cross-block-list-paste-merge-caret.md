# Feature: Cross-block list paste merge — caret at end of pasted content

A cross-block paste of a matching-type list into a non-empty list item merges the
first pasted item into the target leaf at the caret, splices the remaining items
as siblings, and reattaches the surviving post-caret residue to the last pasted
item. The post-paste caret follows the clipboard contract: focus lands at the end
of the pasted content.

## Happy paths

- Cross-block selection from a list item's end into a paragraph below merges the
  paragraph's tail into the list item; pasting a matching list reattaches that
  tail (the residue) to the last pasted item. Focus lands at the end of the last
  pasted item, before the residue — typing a character appends it there, not past
  the residue.
- Single-item clipboard (singleton merge): the one pasted item merges into the
  target leaf and the residue reattaches after it in the same leaf; focus lands
  at the join, before the residue.

## Edge cases

- No residue (caret at the block end after the delete): the end of the pasted
  content coincides with the item end, so the caret lands there either way.
