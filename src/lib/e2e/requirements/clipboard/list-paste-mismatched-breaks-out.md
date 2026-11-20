# Clipboard: Mismatched-Type List Paste Breaks Out

When the clipboard's top block is a list whose ordered-flag does not match any ancestor list of the target, pasting at a position inside a list item splits the enclosing list and splices the pasted blocks between the halves at the list's parent level, rather than nesting the paste as a sub-list. The matching-type case is `list-paste-absorbs-same-type`; this file covers the other type.

Design reason: pasting `1. a\n2. b\n` (ordered) into `- target` (unordered) with the default "splice at target's level" behavior produces a nested sub-list at the listItem's indent plus a trailing-paragraph artifact at the item-continuation indent. Users almost never want that: they copied a top-level list and expect a top-level list. Break-out preserves the pasted structure's semantic level and avoids surprise.

## Happy paths

- Ordered list pasted into the middle of an unordered item: the item splits, the ordered list lands between the halves at the list's parent level, trailing text becomes a new unordered item.
- Caret after a mid-item break-out, the clipboard ending in a line ending: the ending opens an item of the host list's kind under the pasted list, empty, and the caret lands in it, never on the trailing residue half. Typing a character goes into that item.
- Ordered list pasted at the end of an unordered item: item stays intact, ordered list follows at the parent level. No second-half item.
- Ordered list pasted at the start of an unordered item: ordered list precedes the item at the parent level. No first-half item.
- Unordered list pasted into an ordered item: symmetric to the ordered-into-unordered case. Continuous numbering across the gap (split slot burns one number; second half starts at `firstHalfItems.length + 1`), and where the clipboard ends in a line ending, the item it opens takes that number and the second half numbers on after it.

## Edge cases

- Matching-type list paste: the items join the list (`list-paste-absorbs-same-type`), so nothing breaks out.
- Caret inside a container nested in the item (a quote in the item): the list lands in that container, and the item is not split.
- Trailing slice with a leading space: every byte stays, and the second-half item reads that space into its marker the way a reload does (`-  three`, marker `-  `), the same as Enter at that spot.
