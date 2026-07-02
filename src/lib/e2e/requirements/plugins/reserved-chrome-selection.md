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
- windowing: the reserved chrome row keeps BlockListState ids/refs in lockstep across edits

## Gate 4 — rangeDelete chrome wall (must pass)

Nothing merges across the note's wall: outside endpoints truncate in place,
covered chrome clears (never node-deletes), and the container dies only when
the range consumes its whole subtree from outside.

- full title coverage: Delete over a selection from the paragraph above through the whole title clears the chrome to an EMPTY note-title — the body never hoists into the opener line; undo restores byte-for-byte
- gesture parity: the historical Delete-into-title keyboard gesture (whose sticky column lands at title offset 0) truncates the paragraph above and leaves the chrome intact
- partial title coverage: the title keeps its uncovered tail in the chrome leaf, never merged into the paragraph above
- chrome-between: a selection from above the callout into a body child truncates the start in place, clears the chrome, and keeps the end body child's tail in place (later body children untouched)
- start-in-chrome, end outside: the title keeps its head, all body children delete, the container survives title-only, and the outside end block keeps its tail in place
- whole-subtree coverage (both variants): a range strictly around the container, and a range ending exactly at its last byte, both delete the container as one unit — no invariant fires on the detached node
- gate tightness: a body-only range inside the callout stays on the generic path — type-over merges the two body paragraphs exactly like the same gesture in a blockquote

## Gate 5 — paste into the title (must pass)

The chrome leaf is single-line by serialization, so any paste whose target is the
reserved chrome is forced inline ahead of the container-paste family: the clipboard
flattens to one line spliced at the caret, the chrome stays a single node, and the
container family never fires.

- multi-block clipboard: pasting a two-paragraph clipboard into the title splices its text inline at the caret with the paragraph break collapsed to a single space — the chrome stays one note-title node (never splits into paragraphs) and the container-paste family never fires
- CRLF paragraph break: a Windows clipboard's `\r\n\r\n` break collapses to a single space, not two — each run flattens once, so the pasted title carries no doubled whitespace

## User interactions

- Shift+End, Shift+ArrowDown, pointer drag, ArrowRight, Backspace, Enter, Ctrl+V, Ctrl+Z are real gestures; assertions read the CST/selection by path, never the DOM shape
