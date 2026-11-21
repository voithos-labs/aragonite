# Feature: a plugin's marker pair draws nothing and edits around its text

The `comment-anchor` harness plugin lists `markerPair({ open: '{>>id}', close: '{<<id}' })` with the
default `text`, so each side gives a letter typed at it to the text between them. Seed
`comment-anchor`: block 0 `A {>>a}noted{<<a} word`, blocks 1 and 2 `Across {>>b}two` and
`blocks{<<b} end`, block 3 `Some {>>c}**bold**{<<c} text`, block 4 `{>>d}whole line{<<d}`, block 5
`An {>>e}{<<e} empty pair`, block 6 `A lone {<<x} side`.

## Happy paths

- In live mode a pair across two blocks shows `Across two` and `blocks end`; source mode shows the
  bytes.
- A letter typed at the open side lands after it, whether the arrows brought the caret from outside
  the text or from inside it.
- A letter typed at the close side lands before it, from either direction.
- A letter typed at a loaded empty pair lands between its two sides.

## Edge cases

- Backspace beside a side, including from the raw offset past it, takes the character shown before
  it and leaves the side whole; a side is never cut by character, since its bytes would then show.
- Delete beside a side takes the character shown after it.
- Backspace through the text between the sides empties the pair and keeps both; the next letter
  lands between them.
- Around a bold, a letter at the open side joins the text outside the bold, and one at the bold's
  end joins the bold.
- A side opening a line and one ending it take the letters typed at the line's start and end.
- Backspace at a line opening with a side joins the line to the one above, the side kept.
- Enter at a side leaves the side whole, on the half holding its text; Enter at the end of a line
  closing a pair opens an empty line, with no side on it.
- Enter at a side that closes against a bold keeps the side with the bold, from either direction:
  the arrows leave the caret inside the bold's hidden closer, beside the side. The same at a side
  closing against a link.
- Two anchors opening and closing on one word: a letter at their start lands inside both, and
  Enter at either end leaves all four sides with the word.
- A side with no partner draws nothing and takes a letter on its text side.

## User interactions

- The arrows cross both sides of `A noted word` with no extra stop: twelve presses reach the line's
  other end, either way.
- In preview-inline a side shows its bytes once the caret is beside it, and is hidden before.

Miss-analysis: a plugin construct could only draw something before this lane, so nothing asked
the edge rule about one that draws nothing.

Miss-analysis (Enter against a bold, two anchors on one word): every Enter and letter row held
one side at its screen position with plain text beside it, so the caret only ever had the side's
own two raw offsets. A second hidden run at the position (a bold's closer, another side) gave it
a third, where Enter left a side on the half without its text and a letter landed outside both.
