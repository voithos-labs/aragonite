# Feature: Complex cross-block copy-paste — Container Boundary Scenarios

Cross-block copy across container (list, blockquote) boundaries collects only the selected items and the right surrounding markers.

## Happy paths

- Copy across container boundaries (list-to-list): only selected items appear

## Edge cases

- Copy last unordered list item + first ordered list item: no extra items from either list
- Copy from blockquote second paragraph to document end: list markers and code block present
- Copy from ordered list last item across code block to final paragraph: only selected content
