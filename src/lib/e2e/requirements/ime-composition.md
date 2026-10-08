# Feature: IME composition sequences through the real browser event order

Drives real `compositionstart` → mid-composition input → `compositionend` sequences in
Chromium against the three blocks built on the shared editable core (paragraph, code block,
table cell). Complements the handler-level unit contract in
`src/lib/test/blocks/editable-surface-composition.test.ts`: this half pins the browser's
event order and the wiring from the real contenteditable listeners down to the CST.

## Happy paths

- Compose multi-update text into a paragraph, then commit: the document source stays
  byte-stable through every mid-composition update (the composing check), and the committed
  text lands exactly once at compositionend. The result round-trips.
- Same sequence into a code block: committed text lands once inside the fence.
- Enter after a committed composition in a code block inserts a newline in the body: the
  `insertLineBreak` check applies mid-composition only, never after the window closes.
- Same sequence into a table cell (the third block built on that core): the cell's source
  updates once, round-trips.

## Edge cases

- A composition started over a selection replaces it: the browser's own composition window owns
  that delete, so the committed run leaves one copy and the selected bytes are gone.
- A composition started over a range across two blocks removes the range first, then composes
  where it was. One Ctrl+Z takes back both the composed text and the removal. The range is drawn
  downward, so the caret sits in the block the removal keeps.
  - Miss-analysis: every composition here started inside one block, where nothing gets removed
    first, so the two undo entries a range composition left behind were never seen.
- Composing into an empty block the editor put the caret in commits once, with no stray first
  update and nothing doubled. The routes are Enter at the end of a paragraph or a quote, a
  Backspace that empties a paragraph, the arrows back into an empty paragraph, Tab into an empty
  table cell, and `placeCaret` into an empty document, each in source and live mode, each with a
  one-update composition (`か`) and a several-update one (`k`, `か`, `かん`, then `漢`).
  - Miss-analysis: every composition here started in a block that already had text, so nobody
    composed after an empty block's `<br>`, the one spot where Chromium drops the composition.
- Two controls compose the same way and pass with or without that fix: a click into an empty
  document (the browser puts the caret before the `<br>` itself) and Enter at the end of a list
  item (its marker span sits before the `<br>`).
- Undo after a composed commit restores the pre-composition text in one step: the whole
  composition is a single undo entry (the commit goes through one `updateBlockContent`,
  whose debounced snapshot anchors at the pre-composition offset).

## Error cases

- Zero `[invariant:…]` fires across every scenario, enforced automatically by the shared
  fixture watcher (`fixtures.ts`), which fails any spec whose page emits one. The
  composition-window check (G1.27) watches these exact sequences, which makes this the first
  deliberate real-browser exercise of that assertion.
