# Clipboard: Mismatched-Type List Paste Breaks Out

When the clipboard's top block is a list whose ordered-flag does not match any ancestor list of the target, pasting at a position inside a list item splits the enclosing list and splices the pasted blocks between the halves at the list's parent level — rather than nesting the paste as a sub-list. The matching-type case is handled earlier by `list-paste-flattens-into-matching-list`; this file covers the complementary mismatched-type case.

Design reason: pasting `1. a\n2. b\n` (ordered) into `- target` (unordered) with the default "splice at target's level" behavior produces a nested sub-list at the listItem's indent plus a trailing-paragraph artifact at the item-continuation indent. Users almost never want that — they copied a top-level list and expect a top-level list. Break-out preserves the pasted structure's semantic level and avoids surprise.

## Happy paths

- Ordered list pasted into the middle of an unordered item: the item splits, the ordered list lands between the halves at the list's parent level, trailing text becomes a new unordered item.
- Caret after a mid-item break-out: focus lands at the end of the last pasted item (the editor's "end of the pasted content" contract), never on the trailing residue half. Typing a character appends it to the last pasted item.
- Ordered list pasted at the end of an unordered item: item stays intact, ordered list follows at the parent level. No second-half item.
- Ordered list pasted at the start of an unordered item: ordered list precedes the item at the parent level. No first-half item.
- Unordered list pasted into an ordered item: symmetric to the ordered-into-unordered case. Continuous numbering across the gap (split slot burns one number; second half starts at `firstHalfItems.length + 1`).

## Edge cases

- Matching-type list paste: handled by `findContainerMatchingUnwrap` earlier in the pipeline — this path does not fire.
- Target deeper than a direct child of the listItem (e.g. target is inside a nested container within the item): falls through to the default structural paste. The break-out helper intentionally keeps the "target is a direct listItem leaf" precondition narrow to keep the splitting algorithm simple.
- Trailing slice with a leading space/tab: the first whitespace character is trimmed so the resulting second-half item serializes with a single-space marker (`- three`, not `-  three`).
