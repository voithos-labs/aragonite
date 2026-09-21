# Feature: composition under the WebKit IME branch

WebKit exposes no CDP session, so composition here rides a hand-fired sequence at the focused
editable element: `compositionstart`, the composed run written into the DOM the way an IME writes
it, `compositionupdate` plus a composing `beforeinput`/`input` pair, then `compositionend` carrying
the committed data. The driver keeps that branch behind the same `ImeDriver` the CDP branch
implements, so no scenario below knows which browser drove it.

**What these scenarios prove:** the one path every commit goes through survives a WebKit-shaped
sequence, and the commit does not apply twice at `compositionend`, the shape of #37.

**What they do not prove: the event order.** A hand-fired sequence asserts the order the harness
chose, not the order a browser produces. The order stays pinned in the Chromium/CDP spec
(`requirements/ime-composition.md`), and a green run here is no evidence about Safari's ordering.

## Happy paths

- Compose multi-update text into a paragraph and commit: the source stays byte-stable through every
  mid-composition update, and the committed run lands exactly once at `compositionend`.
- Compose at a construct edge in live mode, the caret at the end of an emphasis run: the commit
  lands once, inside the construct, and the delimiters survive. That it lands inside is the
  contract of the caret position at a block edge
  (`components/blocks/text/edge-seat.ts`). The edge itself is pinned under Chromium
  (`presentation/presentation-live-typing-affinity.md`, `presentation/presentation-live-pending-marks.md`);
  what only these runs see is that rule under a second browser, so a deliberate change to it
  updates this scenario and no Chromium check will say so.

## Edge cases

- Abort a composition in progress: the composition window closes writing no bytes and the source is
  the one from before the composition, so an abandoned candidate leaves nothing behind.

## Error cases

- Zero `[aragonite:…]` console lines across every scenario, so the fixture's console check is live
  for these runs. It is not an exercise of the composition-window check (G1.27): this driver
  cannot emit a `compositionend` with no start, since `commit` opens a window first and `abort`
  does nothing when none is open. Exercising G1.27 would take a deliberate unpaired end, which the
  driver's interface does not offer and should not grow for one assertion.
