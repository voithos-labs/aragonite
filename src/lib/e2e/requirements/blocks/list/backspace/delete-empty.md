# Block: List, Backspace (delete empty item)

Backspace at the start of an empty list item deletes the item; if it's the only item, the entire list is removed.

## Delete empty item

- Backspace at start of empty first item (with siblings): delete the item, focus next item
- Backspace at start of empty non-first item: delete the item, focus previous item
- Backspace at start of empty only item: delete the entire list, focus the block before it
- Backspace on empty only item when list is the first block: delete the list and focus the next block
- Live mode, Backspace on an empty item below `- **a**`: the caret lands at the end of the item above, where the character before it is bold, so typing `x` gives `- **ax**`, the same as at the top level
  - Miss-analysis: only an arrow key's own move told the caret which side of a hidden closer it meant, and no test typed after an edit that landed at an item's end.
