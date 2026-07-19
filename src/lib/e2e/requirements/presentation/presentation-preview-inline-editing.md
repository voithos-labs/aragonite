# Feature: inline-granular live preview — editing stays live

`preview-inline` is a fully live editing mode: a revealed construct is normal
source text (the CSS reveal just makes the markers visible again), so typing,
undo, and round-trip behave exactly as in source mode. The reveal state survives
the per-keystroke rebuild (re-applied after render, before paint) and never
fires mid-IME-composition.

## Happy paths

- typing inside a revealed construct edits the source normally: the keystroke
  lands in the raw, the markers stay revealed across the rebuild, and
  `getSource()` round-trips byte-exactly
- typing at a revealed construct's marker text (caret between the `*`s) edits
  those bytes honestly — the construct reparses and the document reflects it

## Edge cases

- undo after typing inside a revealed construct restores the prior source with
  per-keystroke batching (one Ctrl+Z per keystroke, as in source mode)
- deleting a construct's closing marker while revealed reparses the block (the
  construct dissolves; no stale reveal class remains on dissolved spans)
- rapid caret walks (no pause between presses — faster than the browser delivers
  selectionchange) land exactly on target offsets: the keydown backstop reveals
  before each step, so arrow motion never skips hidden marker bytes

## User interactions

- mode flip while a construct is revealed: switching to `preview-block` shows all
  the focused block's markers; switching back to `preview-inline` re-evaluates the
  caret chain and shows only that chain's markers
- switching to `source` shows every marker everywhere; the document bytes are
  unchanged by any amount of mode flipping

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
