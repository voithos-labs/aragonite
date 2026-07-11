# Feature: Block math commit kernel — edits past the fence re-split the document

Committing a revealed `$$…$$` source whose edited text no longer parses as one block
must land as a structural replacement: the math block plus every trailing block the
text parses to. The pre-fix behavior crammed the trailing text into the math node
(same-kind reparse was a raw-only write), leaving a stuck KaTeX error until reload.
Seed: `Before` / `$$x^2$$` / `After`.

## Happy paths

- Reveal, append a blank line + `hello` after the closing fence, blur: the document
  re-splits into math + paragraph (`Before`, `$$x^2$$`, `hello`, `After`), the math
  re-renders clean KaTeX, and the round trip is stable
- Reveal, delete both `$$` fences, blur: the block becomes a paragraph `x^2` (the
  kind-change path still works through the factory)

## Edge cases

- The blur-commit ends with a live, deterministic caret: the fold's relayout during
  the blurring click consumes the click's own focus (Chromium drops it to body), so
  the commit restores the caret to the edit position in the split-off paragraph.
  (When a blur's focus transfer succeeds — no relayout under the pointer — the
  structural commit's focus restore recognizes focus moved on and does not yank it;
  covered at the unit level by the replacement-focus guard.)
- Undo after the split restores the single pre-edit math block in one step (the whole
  reveal→edit→blur cycle is one undo entry)
