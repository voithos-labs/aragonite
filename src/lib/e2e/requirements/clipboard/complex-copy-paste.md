# Feature: Complex cross-block copy-paste scenarios

Real-world copy-paste against the full DEFAULT_CONTENT document structure.

## Happy paths
- Copy across formatted + link paragraphs: all markdown markers preserved
- Copy heading through formatted paragraph: heading marker preserved
- Copy across container boundaries (list-to-list): only selected items appear

## Edge cases
- Copy last unordered list item + first ordered list item: no extra items from either list
- Copy from blockquote second paragraph to document end: list markers and code block present
- Copy from ordered list last item across code block to final paragraph: only selected content
- Select inside code block across its boundary into paragraph: code content + paragraph text
- Bottom-to-top (reverse) cross-block copy: block above anchor is present, anchor block excluded when anchor offset is 0

## User interactions
- Cut three headings then undo: exact restoration of all blocks
