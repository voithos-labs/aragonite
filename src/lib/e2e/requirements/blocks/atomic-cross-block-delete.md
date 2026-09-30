# Feature: Cross-block delete and cut through an atomic leaf block

Destructive cross-block operations (Backspace delete, Ctrl+X cut) whose selection spans a
prose block, an **atomic** leaf block that cannot absorb prose (fenced code, thematic
break), and a following prose block. The two failures this guards against are the prose on
the focus side fusing into the atomic block's body (the `4after` fusion) and an orphaned
code fence or `---` left behind.

The structural invariants below must hold whichever shape the editor leaves the surviving
blocks in; they are checked instead of a guessed exact output string.

## Hard invariants (must hold for every scenario)

- The tree converges after the operation: the live tree matches a reparse of its own
  serialization, not merely `serialize(parse(getSource())) === getSource()`, which holds for any
  valid GFM. That catches a delete leaving a stale grid or a split separator, which the
  byte round-trip cannot see.
- No fenced-code body text fused into surrounding prose.
- No orphaned code fence and no orphaned `---` thematic-break marker left in the source.
- No console errors, page errors, invariant warnings, or editor `error` events during the
  operation.

## Happy paths

- Partial selection from a paragraph, through a fenced code block, into a following
  paragraph → Backspace: the code block and the selected prose span are gone; the
  surviving ends collapse into prose with no fused code body.
- The same partial span → Ctrl+X: as above, and the clipboard holds the selected code
  content while the document no longer holds it (no duplication).
- Partial selection spanning a thematic break (`---`) → Backspace: the break and the
  selected span are gone; the surviving ends collapse into prose.
- The same span → Ctrl+X: as above, and the clipboard holds the selected content while
  the document no longer holds it.

## User interactions

- The selection is made with real input (a pointer drag, falling back to extending with the
  keyboard) and must be in cross-block mode (`data-cross-block` attached) before the operation runs.
