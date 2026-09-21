# Feature: inline-granular live preview: editing stays live

`preview-inline` is a fully live editing mode: a construct showing its markers is
normal source text (the CSS just makes the markers visible again), so typing,
undo, and round-trip behave exactly as in source mode. Which constructs are
showing survives the per-keystroke rebuild, re-applied after render and before
paint, and never changes in the middle of an IME composition.

## Happy paths

- typing inside a construct showing its markers edits the source normally: the
  keystroke lands in the raw, the markers stay visible across the rebuild, and
  `getSource()` round-trips byte-exactly
- typing at a shown construct's marker text (caret between the `*`s) edits those
  bytes honestly: the construct reparses and the document reflects it

## Edge cases

- undo after typing inside a shown construct restores the prior source with
  per-keystroke batching (one Ctrl+Z per keystroke, as in source mode)
- deleting a construct's closing marker while its markers are visible reparses the
  block: the construct dissolves, and no stale class stays on the dissolved spans
- rapid caret movement (no pause between keypresses, faster than the browser
  delivers selectionchange) lands exactly on the target offsets: the keydown
  backstop shows the markers before each step, so arrow motion never skips hidden
  marker bytes

## User interactions

- a mode switch while a construct's markers are visible: switching to
  `preview-block` shows all the focused block's markers; switching back to
  `preview-inline` re-evaluates the constructs the caret sits inside and shows
  only their markers
- switching to `source` shows every marker everywhere; the document bytes are
  unchanged by any amount of mode switching

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
