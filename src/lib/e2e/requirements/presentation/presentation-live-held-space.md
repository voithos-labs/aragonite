# Feature: live-mode held space (bold doesn't stop at the first space)

Live mode hides the `**` around `**two**`, so the caret right after `two` could mean inside the
closer or past it. A space can't sit inside the closer (`**two **` isn't bold anymore, and the
markers would show up again), so the space gets written past it: `a **two** `. The caret still
means inside though, and the next letter takes the space back in with it: `a **two w**`. That's
the held space (`cursor/held-space.ts`). Anything that moves the caret or picks a side ends it,
and since the bytes were valid the whole time, ending it changes nothing on screen.

Every way text arrives (a key, a soft keyboard, an IME commit, a paste) goes through the same
write, so they all land the same bytes. Driven on `/test/editor` via `?presentationMode=live`
with real keys, real clicks, a CDP composition and the clipboard; every scenario checks the
source.

## Happy paths

- typing `a **two words` keeps both words bold, for `**`, `*`, `_` and `~~`, on a hardware
  keyboard
- the same, typed on a soft keyboard (text arrives on `beforeinput` with no key behind it)
- the space and the next word committed by an IME land inside too
- the space and the next word pasted land inside too
- a click at the end of an existing bold, then ` more`, extends the bold
- a second space keeps the hold: the letter after it takes both spaces in

## Edge cases

- arriving at the end of a bold from outside (ArrowLeft) types the space and the word outside
- the format chord before the space types it outside, as it does a letter
- the ring (`md-edge-held`) stays on the bold while a space is held, and one ArrowRight takes it
  off
- a click away after `a **two** ` leaves those bytes as they are, and typing back at the line's
  end types plain text
- after an arrow steps out of a bold, a paste types outside it, like a hardware key does

## Ways out (easy to leave without a new line)

- the typed closer ends it, at a line's end and mid-line
- the construct's own chord (Mod+B in a bold) ends it: `a **two** ` then Mod+B then `x` gives
  `a **two** x`
- another mark's chord ends it too, and still arms its mark for the next letter, which lands past
  the bold: Mod+I after `a **two** ` then `x` gives `a **two** *x*`, the same bytes as with no
  space held. Miss-analysis: the exit rows pressed only Mod+B in a bold, so a chord the hold
  swallowed whole passed
- End ends it: at a line's end the letter lands right after the space, mid-line at the end of
  the line

A few more are pinned below the browser, in `src/lib/test/blocks/text/held-space.test.ts` and
`insertion-route-parity.test.ts` next to it: one ArrowRight ending the hold without moving the
caret, at a line's end and mid-line; Mod+B ending it mid-line; a soft keyboard typing outside
after an arrow step; and source mode writing the space where the caret is, inside the visible
closer, on every route.

Miss-analysis: every live typing row typed a letter at a construct's edge, never whitespace, the
one byte a closer can't follow; and every row pressed hardware keys, so the soft keyboard and paste
routes never met a hidden edge at all.

## User interactions

- Real keyboard, `insertText` for the soft keyboard, a CDP composition, and the clipboard: each
  route goes through its own browser events, which is the whole point of testing them apart

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e
  fixture)
