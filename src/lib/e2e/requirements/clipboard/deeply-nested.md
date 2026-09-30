# Clipboard Exploration: Deeply Nested

Paste scenarios where the target lives inside multiple layers of containers: the stress test for how the dispatch and container-state code resolve paths.

## Happy paths

- Paste multi-paragraph content into a nested list item (list > item > list > item > paragraph): content lands inside the nested item.
- Paste structural content into list item inside blockquote: structural blocks land correctly.
- Cross-block paste inside a nested list replaces the selection without corrupting outer layers.
