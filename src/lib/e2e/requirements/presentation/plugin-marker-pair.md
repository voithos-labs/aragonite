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

## A live removal across a side

- A word delete after a commented word keeps both sides, an empty pair: `A {>>a}{<<a}word`.
- A word delete forward from outside the open side keeps both sides the same way.
- A word delete of the whole commented word leaves an empty pair, and the next letter lands in it.
- A range across the open side puts the side back before the kept text: `A{>>a}ted{<<a} word`.
- A range across the close side puts it back after the kept text: `A {>>a}not{<<a}word`.
- A letter typed over a range across the open side joins the pair: `A{>>a}Qted{<<a} word`.
- A letter typed over the commented text exactly stays in the pair.
- A range reaching past both sides takes the pair.
- A range across two blocks keeps a pair spanning them: `Acr{>>b}cks{<<b} end`.
- A word delete across one end of a pair spanning two blocks keeps that end: `{<<b}end`.
- A word delete inside a pair around a bold keeps both sides.
- A cut pasted back gives the original bytes; a dragged range carries no side its pair keeps.
- A cut across one end of a pair spanning two blocks keeps that end and leaves it off the
  clipboard (`blocks `), so pasted back the end is there once; a drag of the same range moves no copy.
- Formatted text pasted into a bold a pair holds writes no second pair:
  `Some {>>c}**box** y**ld**{<<c} text`.
- A cut of the whole line a pair wraps carries the pair, and a paste brings it back.
- Source mode takes the bytes selected, sides with them.
- Undo gives the bytes back after each.

Limits, recorded: the join sees a partner only in the blocks a range joins, and inside one block it
keeps a side whose partner it can't see. A pair spanning two blocks loses the end a range takes
with its whole block, and the end select-all then Delete takes in its block. A range over
three blocks taking a whole pair leaves no side. A selection across a lone side inside its block
leaves the side (`A lo{<<x}ide`), and a range from a paragraph into a table holding the partner
leaves a lone side (`Pa{>>p}`).

Miss-analysis (a removal across one side): every removal row took one character beside a side,
never a range across one, so the join every range removal shares had no row.

Miss-analysis (a second pair on a paste): every row removed bytes, so nothing landed text that
brings its own bold, whose two joins move bytes aside without removing any.

Miss-analysis (a whole line cut): the cut rows selected inside a line, where the removal keeps a
side at the selection's edge. Select-all in a block takes its whole text, sides and all, and the
clipboard still left them out.

Miss-analysis (a side doubled by a cut or drag in one block): each change to the pair's removal
rule came with rows for its own gesture, and none moved the text across a side whose partner sits
in another block, which the removal keeps and the piece carried too.
