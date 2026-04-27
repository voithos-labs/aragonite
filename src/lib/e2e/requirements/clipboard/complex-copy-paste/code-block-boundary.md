# Feature: Complex cross-block copy-paste — Code Block Boundary and Direction

Selections that cross a code-block boundary (in either direction) and bottom-to-top reverse selections must copy the right content.

## Edge cases

- Ctrl+Shift+End from inside a fenced code block enters cross-block mode and extends focus to the final block; copy yields code content + trailing paragraph text.
- Shift+ArrowDown from the end of a fenced code block enters cross-block mode with the anchor in the code block and the focus on the next block.
- Bottom-to-top (reverse) cross-block copy: block above anchor is present, anchor block excluded when anchor offset is 0.
