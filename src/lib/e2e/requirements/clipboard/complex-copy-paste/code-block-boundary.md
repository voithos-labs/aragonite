# Feature: Complex cross-block copy-paste — Code Block Boundary and Direction

Selections that cross a code-block boundary (in either direction) and bottom-to-top reverse selections must copy the right content.

## Edge cases

- Select inside code block across its boundary into paragraph: code content + paragraph text
- Bottom-to-top (reverse) cross-block copy: block above anchor is present, anchor block excluded when anchor offset is 0
