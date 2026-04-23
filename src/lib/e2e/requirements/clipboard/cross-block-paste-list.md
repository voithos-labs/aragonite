# Feature: cross-block clipboard — paste into list selections

## Happy paths

- Single-block text paste into a cross-list-item selection replaces the range with the clipboard text.
- Paste into a selection covering two of three list items replaces only those two; the untouched item survives.
- Paste into a selection covering items 2 and 3 of a 3-item list replaces those two; item 1 survives.
- Multi-block text paste into a cross-list-item selection lands both pasted blocks as siblings inside the container.
- Copy across list items then paste across different list items round-trips the copied slice without losing content.
- Paste covering an entire list between two paragraphs replaces the list with the clipboard text and leaves surrounding paragraphs intact.

## Edge cases

- Mid-paragraph-offset cross-block paste splices the clipboard text between the pre-anchor head and the post-focus tail, producing a single merged item.
- Drag selection across list items (empty native selection) still receives the paste — the paste handler parks a caret in the focus block regardless of entry gesture.
