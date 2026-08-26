# Feature: IME composition sequences through the real browser event order

Drives real `compositionstart` → mid-composition input → `compositionend` sequences in
Chromium against the three editable-surface consumers (paragraph, code block, table cell).
Complements the handler-level unit contract in
`src/lib/test/blocks/editable-surface-composition.test.ts` — this half pins the browser's
event ORDER and the wiring from the real contenteditable listeners down to the CST.

## Happy paths

- Compose multi-update text into a paragraph, then commit: the document source stays
  byte-stable through every mid-composition update (the composing gate), and the committed
  text lands exactly once at compositionend. The result round-trips.
- Same sequence into a code block: committed text lands once inside the fence.
- Enter after a committed composition in a code block inserts a newline in the body — the
  `insertLineBreak` gate applies mid-composition only, never after the window closes.
- Same sequence into a table cell (the third editable-surface consumer): the cell's source
  updates once, round-trips.

## Edge cases

- A composition started over a selection replaces it: the engine's own composition window owns
  that delete, so the committed run leaves one copy and the selected bytes are gone.
- Undo after a composed commit restores the pre-composition text in ONE step — the whole
  composition is a single undo entry (the commit funnels through one `updateBlockContent`,
  whose debounced snapshot anchors at the pre-composition offset).

## Error cases

- Zero `[invariant:…]` fires across every scenario — enforced automatically by the shared
  fixture watcher (`fixtures.ts`), which fails any spec whose page emits one. The
  composition-window guard (G1.27) watching these exact sequences makes this the assert's
  first deliberate real-browser exercise.
