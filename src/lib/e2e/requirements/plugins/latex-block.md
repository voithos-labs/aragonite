# Feature: Block `$$…$$` display math — render-primary, source-on-focus

A `mathBlock` leaf renders its KaTeX display by default and reveals the raw `$$…$$`
source in a contenteditable on focus/click, re-rendering on blur. It is not-mergeable
and focusable, and while revealed the source behaves like a code block for caret and
selection. Driven through real mouse/keyboard only — the reactive render↔source swap
and the caret's survival across it are exactly what the unit layer could not prove
(the Task 10 reveal-primitive finding deferred it here).

## Happy paths

- Renders the KaTeX display by default: a folded block shows `.katex`, no source
  contenteditable, and the CST still holds `$$x^2$$`
- Click reveals the editable source without touching the CST: the render is gone, the
  raw `$$x^2$$` is visible, editable text, and the source has not changed (view toggle)
- Edit the source and blur re-renders: the block folds back to a KaTeX display and the
  edit persists to the CST, round-trip stable

## User interactions

- Arrow into the block from a sibling reveals the source; arrowing back out of either
  edge folds it and lands focus on the adjacent block
- ArrowUp/ArrowDown traverse in and out of the block by sticky column, like a code block
- A paste into the revealed source is intercepted to plain text: HTML on the clipboard
  is dropped, not injected as live markup, and the edit stays ephemeral until blur
  commits it (folded, the widget falls to native copy — there is no source to slice)

## Edge cases (spec's named highest-risk)

- **A1** the caret is preserved across the swap: after reveal it sits at the requested
  source offset (leading edge on click), not displaced to a block edge by the reactive
  re-render; a char then typed inside the formula lands at the caret
- **A7** a multiline `aligned` fence renders, and its revealed source stays a single
  text node whose `textContent` equals the raw byte-for-byte (internal `\n`s intact),
  so the offset walk is exact
- A selection extended across the revealed source's boundary enters cross-block mode and
  the source stays revealed while the selection is live (a folded island could not be
  selected through)
- Undo after a reveal→edit→commit cycle restores the pre-edit source in one step (the
  ephemeral edit committed as a single undo entry)
