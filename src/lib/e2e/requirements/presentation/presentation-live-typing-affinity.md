# Feature: live-mode typing seat (which side of a hidden delimiter typed bytes land)

Live paints no construct marker, so one screen position names two raw offsets — before
the closing `**` and after it. Typing is native, and Chromium canonicalizes a collapsed
caret UPSTREAM across a non-rendered run, so the DOM caret cannot express "after the
run": the seat is decided at the keystroke and the byte is written through the CST. An
IME commit cannot be intercepted at all (`insertCompositionText` is not cancelable), so
its composed run is relocated on the commit `compositionend` drives — the same seat, one
commit, one undo entry. Two inputs decide it — the kind's `edgeAffinity` policy first (a
link never extends at either edge), the arrival affinity second. Driven on `/test/editor`
via `?presentationMode=live` with real keystrokes, real clicks and a real CDP composition;
the assertion is always the SOURCE, since the byte position is the whole contract.

## Happy paths

- typing at bold's trailing content edge after arriving there from inside extends the
  construct: the byte lands before the closing `**`
- a second byte typed at the new trailing content edge keeps extending it — a committed
  keystroke re-arms the near side whatever arrival preceded it
- a caret that arrived at bold's trailing edge from OUTSIDE (a leftward step across the
  hidden run) types PAST the construct: the byte lands after the closing `**`
- a caret that stepped LEFT out of bold's leading edge types INSIDE the construct: one
  press has not left it yet, so the byte lands after the opening `**`
- a caret that stepped RIGHT up to bold's leading edge types before it, plain
- a CLICK at bold's trailing content edge extends the construct: a click clears the
  arrival, and the seat's default is the construct the caret touches (the gdocs default)

- a CHILDLESS construct is all delimiters, and the seat reaches it: a line-leading escape or an
  angle autolink has no content range to split on, so a byte typed at the landable floor inside
  one used to land between delimiters the reader never saw (`\Z*Lead`, `< https://…>`). The whole
  node is one run there, and "outside" is its nearer end
- the angle autolink obeys the same never-extend rule as the bracket form: `End` after a trailing
  one types past the closing bracket rather than rewriting the destination
- the bold control types identically through every one of those gestures, which is what says the
  fix moved the childless class and nothing else

- the other two symmetric pairs seat the same way, on runs bold's cases never exercise: a
  strikethrough's two-byte `~~` and a code span's single backtick both extend from an arrival
  inside them

## Edge cases

- `Home` on a line that OPENS with a construct types BEFORE it: a line extreme is
  construct-relative, not directional, so it resolves to the opener's near side — the
  opposite walk-order answer from `End` after a line-trailing construct
- a link's trailing content edge never extends, whichever arrival seated the caret:
  arrow-from-inside and `End` both put the byte after the closing `)`
- a link's leading content edge never extends either: the byte lands before the `[`
- an escape's two bytes are never typed into: a byte typed at either side of `\*` lands
  outside the pair, and the escape survives verbatim
- a hard break's trailing-space run is never typed into: a byte typed at the end of the
  first visual line lands before the two spaces, which survive verbatim

## IME commits

- a composition committed at a link's trailing content edge lands past the closing `)`,
  never inside the link text — never-extend binds keystrokes and IME commits alike
- a composition committed at bold's trailing edge extends the construct when the caret
  arrived from inside
- the same position arrived at from outside commits past the closing `**`

## User interactions

- Real keyboard, real clicks and a real CDP composition only: the seat is decided inside
  the keydown dispatch and the composition funnel, and a programmatic caret write would
  bypass both — and would be normalized away anyway
- Arrival is established by stepping with arrows, by clicking, or by typing, never by
  asserting the affinity state, which is editor-internal

## Held next door

- The same never-extend rule inside a table cell (`[text][ref]`, `End`, one keystroke) is a
  row of `presentation-live-affinity.md`, where that fixture already lives.

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared
  e2e fixture)
