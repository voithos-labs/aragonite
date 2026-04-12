# Feature: Selection & Clipboard

Single-block text selection and clipboard operations (cut, copy, paste).

## Happy paths
- select text with Shift+Arrow then copy+paste: Shift+ArrowRight to select, Ctrl+C, move cursor, Ctrl+V — text duplicated
- select text then cut: Shift+ArrowRight to select, Ctrl+X — selected text removed from source
- select text then paste replaces selection: select text, Ctrl+V with different text on clipboard — selected text replaced
- select text then type replaces selection: select text, type new text — selected text replaced with typed text

## Edge cases
- cut then undo restores text: Ctrl+X removes text, Ctrl+Z brings it back
- paste at end of block: cursor at end, Ctrl+V appends text
- paste at start of block: cursor at start, Ctrl+V prepends text
- copy does not modify source: Ctrl+C leaves the block unchanged
- cut empty selection is a no-op: Ctrl+X with no selection does nothing

## User interactions
- select word via Shift+Arrow then cut+paste elsewhere: realistic two-step clipboard flow
- select all in block via Ctrl+A then replace by typing: select all, type replacement text
