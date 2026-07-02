# Feature: Fork-A Spike — Reserved-child-0 Chrome Selection

The `:::note` callout reserves child index 0 as an editable `note-title` chrome
leaf, rendered inside the callout's sole `.block-list`. This de-risking spike
proves native-block selection parity extends INTO that chrome, and characterizes
the reserved-index structural ops. Behavioral gate: CST/selection read by path
via `window.__test`, not visuals.

## Gate 1 — selection parity (must pass)

- keyboard cross-select-in: Shift+End then Shift+ArrowDown from the paragraph above paints one cross-block span whose focus reaches the title leaf (`focus.path === [1, 0]`)
- pointer cross-select-in: a drag from the paragraph into the title is cross-block with the same deep focus path
- empty-title edge: cross-select-in still reaches `[1, 0]` when the reserved title is empty (an empty child-0 leaf is a real selection endpoint)
- collapsed caret: collapsing the cross-block selection lands the caret in the title; a typed character appears there (`activeBlockPath === [1, 0]`)
- undo restore: after a title edit, Ctrl+Z reverts the source and returns the caret to the title leaf

## Gate 2 — reserved-index-0 structural ops (correct or characterized)

- merge walk: Backspace at the start of the block AFTER the callout merges into the last BODY child, never the title
- first body-child Backspace: at the start of child 1, the not-mergeable title refuses the merge; focus moves to the title, the tree is unchanged (body prose never enters chrome)
- title Backspace-at-start: a safe no-op (the lift strategy is blockquote-hardcoded and declines for the callout)
- Enter-in-title: descends into the first body child at offset 0 — the chrome never splits, the document and raw are untouched
- Enter-in-title with a title-only callout: mints an empty body paragraph, focuses it, and typing lands in it
- descend undo-cleanliness: descend onto an existing body commits nothing — a single Ctrl+Z afterwards reverts the edit made BEFORE the descend
- typing-in-title: keeps the `note-title` kind (contextDependentKind); the typed title re-renders in the opener line
- range-delete ending in the title (characterized): the title node is deleted and the first body paragraph is hoisted into the opener line — flipped by the reserved-chrome rangeDelete wall
- windowing: the reserved chrome row keeps BlockListState ids/refs in lockstep across edits

## User interactions

- Shift+End, Shift+ArrowDown, pointer drag, ArrowRight, Backspace, Enter, Ctrl+Z are real gestures; assertions read the CST/selection by path, never the DOM shape
