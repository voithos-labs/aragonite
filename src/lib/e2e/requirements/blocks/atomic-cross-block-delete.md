# Feature: Cross-block delete and cut through an atomic leaf block

Destructive cross-block ops (Backspace delete, Ctrl+X cut) whose selection spans a
prose block, an **atomic** leaf block that cannot absorb prose (fenced code, thematic
break), and a following prose block. This class produced the worst 0.7.x bugs: the
focus-side prose fusing into the atomic block's body (the `4after` fusion), or an
orphaned code fence / `---` left dangling.

The structural invariants below must hold no matter which surviving-block shape the
editor chooses — they are asserted instead of a guessed exact output string.

## Hard invariants (must hold for every scenario)

- Convergent after the op: the live tree matches a reparse of its own serialization, not merely
  `serialize(parse(getSource())) === getSource()` (a tautology for valid GFM) — so a delete that
  left a stale grid or split-separator shape is caught where the byte round-trip is blind.
- No fenced-code body text fused into surrounding prose.
- No orphaned code fence and no orphaned `---` thematic-break marker left in the source.
- No console errors, page errors, invariant warnings, or editor `error` events during the op.

## Happy paths

- Partial selection from a paragraph, through a fenced code block, into a following
  paragraph → Backspace: the code block and the selected prose span are gone; the
  surviving endpoints collapse into prose with no fused code body.
- The same partial span → Ctrl+X: as above, and the clipboard holds the selected code
  content while the document no longer holds it (no duplication).
- Partial selection spanning a thematic break (`---`) → Backspace: the break and the
  selected span are gone; the surviving endpoints collapse into prose.
- The same span → Ctrl+X: as above, and the clipboard holds the selected content while
  the document no longer holds it.

## User interactions

- Selection is driven by real input (pointer drag, falling back to keyboard extend)
  and must enter cross-block mode (`data-cross-block` attached) before the op fires.
