# Feature: composition under the WebKit IME arm

WebKit exposes no CDP session, so the lane's composition rides a hand-fired sequence at the focused
editable: `compositionstart`, the composed run written into the DOM the way an IME writes it,
`compositionupdate` plus a composing `beforeinput`/`input` pair, then `compositionend` carrying the
committed data. The driver owns that arm behind the same `ImeDriver` the CDP arm satisfies, so no
scenario below knows which engine drove it.

**What these scenarios prove:** the editor's commit funnel survives a WebKit-shaped sequence, and
the commit does not double-apply at `compositionend` — the #37 shape.

**What they do not prove: event ORDER.** A hand-fired sequence asserts the order the harness chose,
not the order an engine produces. Order stays pinned in the Chromium/CDP spec
(`requirements/ime-composition.md`), and a green run here is no evidence about Safari's ordering.

## Happy paths

- Compose multi-update text into a paragraph and commit: the source stays byte-stable through every
  mid-composition update, and the committed run lands exactly once at `compositionend`.
- Compose at a construct edge in live mode, the caret at the end of an emphasis run: the commit
  lands once, inside the construct, and the delimiters survive. The INSIDE half reads the edge
  seat's contract (`components/blocks/text/edge-seat.ts`). The edge itself is pinned under Chromium
  (`presentation/presentation-live-typing-affinity.md`, `presentation/presentation-live-pending-marks.md`);
  what only this lane sees is that seat running under a second engine, so a deliberate change to
  the seat's contract updates this scenario and no Chromium gate will say so.

## Edge cases

- Abort an in-flight composition: the window closes writing no bytes and the source is the
  pre-composition source, so an aborted candidate leaves no residue.

## Error cases

- Zero `[aragonite:…]` sentinel fires across every scenario, so the fixture's console gate
  is armed for these runs. It is not an exercise of the composition-window guard (G1.27): the arm
  cannot emit an unpaired `compositionend`, since `commit` opens a window first and `abort`
  declines when none is open. Exercising G1.27 would take a deliberate unpaired end, which the
  driver's interface does not offer and should not grow for one assertion.
