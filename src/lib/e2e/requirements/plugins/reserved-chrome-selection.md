# Feature: Fork-A Spike — Reserved-child-0 Chrome Selection Parity

The `:::note` callout reserves child index 0 as an editable `note-title` chrome
leaf, rendered inside the callout's sole `.block-list`. This de-risking spike
proves native-block selection parity extends INTO that chrome. Behavioral gate:
CST/selection read by path via `window.__test`, not visuals.

## Gate 1 — selection parity (must pass)

- keyboard cross-select-in: Shift+End then Shift+ArrowDown from the paragraph above paints one cross-block span whose focus reaches the title leaf (`focus.path === [1, 0]`)
- pointer cross-select-in: a drag from the paragraph into the title is cross-block with the same deep focus path
- empty-title edge: cross-select-in still reaches `[1, 0]` when the reserved title is empty (an empty child-0 leaf is a real selection endpoint)
- collapsed caret: collapsing the cross-block selection lands the caret in the title; a typed character appears there (`activeBlockPath === [1, 0]`)
- undo restore: after a title edit, Ctrl+Z reverts the source and returns the caret to the title leaf

## Substrate

- the seed parses as a real container: the title is a reserved child-0 `note-title` leaf, the callout round-trips byte-for-byte, and no error is captured

## User interactions

- Shift+End, Shift+ArrowDown, pointer drag, ArrowRight, Ctrl+Z are real gestures; assertions read the CST/selection by path, never the DOM shape
