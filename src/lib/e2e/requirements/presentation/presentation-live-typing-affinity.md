# Feature: live-mode typing seat (which side of a hidden delimiter typed bytes land)

Live paints no construct marker, so one screen position names two raw offsets — before
the closing `**` and after it. Typing is native, and Chromium canonicalizes a collapsed
caret UPSTREAM across a non-rendered run, so the DOM caret cannot express "after the
run": the seat is decided at the keystroke and the byte is written through the CST.
Two inputs decide it — the kind's `edgeAffinity` policy first (a link never extends at
either edge), the arrival affinity second. Driven on `/test/editor` via
`?presentationMode=live` with real keystrokes; the assertion is always the SOURCE, since
the byte position is the whole contract.

## Happy paths

- typing at bold's trailing content edge after arriving there from inside extends the
  construct: the byte lands before the closing `**`
- a second byte typed at the new trailing content edge keeps extending it — a committed
  keystroke re-arms the inside side whatever arrival preceded it
- a caret that arrived at bold's trailing edge from OUTSIDE (a leftward step across the
  hidden run) types PAST the construct: the byte lands after the closing `**`
- a caret that stepped LEFT out of bold's leading edge types INSIDE the construct: one
  press has not left it yet, so the byte lands after the opening `**`
- a caret that stepped RIGHT up to bold's leading edge types before it, plain

## Edge cases

- a link's trailing content edge never extends, whichever arrival seated the caret:
  arrow-from-inside and `End` both put the byte after the closing `)`
- a link's leading content edge never extends either: the byte lands before the `[`
- an escape's two bytes are never typed into: a byte typed at either side of `\*` lands
  outside the pair, and the escape survives verbatim
- a hard break's trailing-space run is never typed into: a byte typed at the end of the
  first visual line lands before the two spaces, which survive verbatim

## User interactions

- Real keyboard and real clicks only: the seat is decided inside the keydown dispatch,
  and a programmatic caret write would bypass it — and would be normalized away anyway
- Arrival is established by stepping with arrows or by typing, never by asserting the
  affinity state, which is editor-internal

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared
  e2e fixture)

## Held next door

- The same never-extend rule inside a table cell (`[text][ref]`, `End`, one keystroke) is a
  row of `presentation-live-affinity.md`, where that fixture already lives.

## Known gap

- An IME commit at a construct edge does NOT follow the seat: the composition inserts
  at the DOM caret, and Chromium's `insertCompositionText` beforeinput is not
  cancelable, so the keystroke interception cannot reach it. Relocating the composed
  run belongs to the join-seam cleanup wave (design spec § 4.5), and no row here
  claims IME behavior.
