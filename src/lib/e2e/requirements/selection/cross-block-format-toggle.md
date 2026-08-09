# Feature: a format toggle over a cross-block range declines

A cross-block range has no single block to rewrite, so no format command can run
over it. The chord used to fall through to the type-replace arm, which reads any
unhandled key as text: the range was deleted and an empty `**` pair materialized
at the collapsed caret, leaving the document `****` and an undo that came back
`\n` (#107). The toggle is CONSUMED instead — the chord is claimed so nothing
downstream retypes it, and not a byte moves. Its sibling, plain typing over the
same range, must stay exactly as destructive as it was.

## Happy paths

- `Mod+B`, `Mod+I` and `Mod+E` over a whole-document range leave the source
  byte-identical, in every mode a marker-hiding mode changes nothing about
- `Mod+Shift+X` (strikethrough) declines the same way — the shifted chord reaches
  the same door
- plain typing over the same cross-block range still replaces it, and one undo
  restores the document, so the decline narrowed the toggle and nothing else

## Edge cases

- the decline is a consumption, not an ignore: `defaultPrevented` is true on the
  chord's own keydown, read from a document-level bubble listener that runs after
  the block handler
- the range is built the way a user builds it — a caret, then `Mod+A` twice — so
  the cross-block selection is real and not a programmatic construction

## Error cases

- a declined chord pushes no undo entry: one undo after it must not walk past the
  document load
- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)

## Miss-analysis

- The unit suite pinned the destructive route as the CONTRACT ("deletes the range
  then dispatches") behind a mocked command target, and no e2e ever pressed a
  format chord over a cross-block range, so the `****` document showed nowhere (#107).
