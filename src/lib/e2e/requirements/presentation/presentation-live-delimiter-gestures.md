# Feature: live-mode delimiter gestures (typing a construct closed, and leaving it)

Live paints no delimiter, so the keystrokes that open, close and leave an inline construct are
answered by two seams together: the auto-pair arm (`delimiter-autopair.ts`), which decides what a
typed delimiter writes and steps the caret past a closer, and the typing seat (`edge-seat.ts`),
which decides which side of a hidden run the next byte lands on. These scenarios drive the pair
as one user gesture on `/test/editor` via `?presentationMode=live`, with real clicks and keys; the
SOURCE is the oracle, since the screen cannot show which side of a hidden run a byte took.

## Happy paths

- the closer typed over a construct's hidden closer writes nothing and steps past it: the next
  byte lands after the construct (`Some *em*X text`), for `*`, `**`, `` ` ``, `~~` and an
  emphasis nested inside bold
- the same press arrived at from OUTSIDE (End, then ArrowLeft onto the edge) steps past it too,
  and the next byte lands after the construct
- a closer typed by hand, where no twin was there to step over (`text*ab` then `*`), completes
  the construct and the next byte lands outside it (`text*ab* z`, never `text*ab z*`)
- a link typed to completion keeps typing after it: `[ab](u)` then a space gives `[ab](u) `,
  never `[ab ](u)`
- a delimiter typed at a hidden trailing edge from OUTSIDE lands its twin past the closer
  (`Some **strong**`` text`), not a lone byte
- `Backspace` at a construct's trailing content edge takes the content byte, from either arrival,
  for the pairs the destructive-edges rows never covered: `*`, `` ` ``, `~~`
- `Enter` inside a code span closes and reopens the span, and typing continues in the second half

## Table cell

- a closer typed over a hidden closer in a cell steps past it, and the next byte lands outside
- a closer typed by hand in a cell seats the next byte outside the construct

## Miss-analysis

- Every typing-seat row started from a LOADED construct and arrived at its edge by arrow or click,
  so no row typed a construct to completion and kept typing: the caret a commit parks past a hidden
  closer (raw 12 of `[ab](u) text`) resolved to the slot after the hidden span, which Chromium
  canonicalizes upstream, and the byte landed inside the link text.
- The auto-pair rows always had a twin to step over, so none typed the closer that MAKES the
  construct and asked which side the next byte takes; the typing seat's "a committed keystroke
  re-arms the near side" put it inside.
- The seat's own rows typed only letters at a hidden edge, so the keydown seat writing a single
  delimiter byte before the `beforeinput` arm could pair it was never observed.

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
