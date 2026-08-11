# Feature: the code block's language chip

A marker-hiding mode paints no fence, and a hidden run is unlandable, so once a fenced
block has body content its info string can be neither read nor edited from inside the mode
(issue #142). The chip is that door — the link card's second client, over the fence's info
string instead of a link's destination.

## What the chip is

A button pinned to the code box's top-right, showing the info string's first token, or
`text` when there is none. Click swaps it for a field seeded with the FULL info string;
Enter commits, Escape and blur cancel byte-identically. Only Enter writes.

It is transient, not chrome: hidden until the pointer hovers the block or the caret sits
inside it, per the calm-surface rule the drag handle already follows. It renders OUTSIDE
the contenteditable — a sibling of the walk container, not a child — so the offset walk
never sees it and the render effect's `replaceChildren` cannot destroy it.

## Visibility

- The chip renders in the marker-hiding modes (`reading`, both `preview-*` rungs, `live`)
  when the block is NOT content-empty, and never in source mode, which paints its fence
  always.
- A content-empty block (an empty fence) paints its own chrome and gets no chip: the info
  string is already reachable by caret there, which is how a fence is authored.
- Reveal is hover on the block OR focus inside it; the field being open keeps it revealed.
- Reading mode shows the same chip, inert: a click opens no field, since the mode writes
  no bytes.

## The commit

- Only the info-string span of the OPENING fence line is rewritten. Indent, marker run,
  line ending, body and closer are byte-identical through the write.
- The write goes through the block's one display-commit funnel (`commitDisplay`, G4.24), so
  the fence write rule runs over it like every other gesture, and it lands as ONE undo
  entry — isolated on both sides, so neither a typing burst before it nor one after it
  joins the entry.
- An unchanged info string is a close, not a write: no undo entry, no `edit` event. This is
  also what keeps the seed's trimming (`meta.info` is trimmed) from respelling author bytes
  on a no-op commit.
- After a commit or a cancel, focus returns to the block with the caret at the first body
  offset. Pinned by typing a character, not by asking who has focus: a caret nowhere usable
  reports focus just as well as one that works.

## Bytes the info string cannot hold

The helper refuses what would stop the line reading as this block's opener, at the choke
point rather than at the caller:

- A backtick in a BACKTICK fence's info string is dropped (CommonMark §4.5), including on
  an unclosed fence, where the display funnel's own sanitize pass stands down.
- An info string starting with the fence's own marker is refused outright: it would grow
  the run instead, re-reading `~~~` + `~~~x` as a six-tilde fence.
- A tilde fence's info string may hold backticks, so nothing is dropped there.

## Known gaps

- **No keyboard chord.** v1 is pointer-first; minting a chord before the 1.0 freeze is a
  bigger decision than this affordance. A Tab reaching the button works because the button
  is a button, which is as far as v1 goes.
- **Reading + content-empty paints nothing.** The content-empty reveal CSS covers only
  `preview-*` and `live`, so an empty fence in reading mode shows neither its markers nor a
  chip. Following the stated visibility rule literally rather than special-casing reading;
  an empty code block in a reading view has nothing to say.
- **A focused preview block shows both.** The preview rungs reveal the fence on the focused
  block, and the chip also shows there (the caret is inside). Redundant, harmless, and
  cheaper than teaching the chip to read the focus stamp.
- **Plugin fence kinds do not inherit.** Mermaid and the math fence have their own surfaces;
  the chip is the built-in `fencedCode` component's alone, with no descriptor field and no
  plugin surface behind it.

## Happy paths

- live mode, pointer over the block: the chip reveals and reads `js`
- live mode, caret inside the block and the pointer away: the chip reveals
- an empty info string reads `text`
- click, type a new language, Enter: the source shows the new info string with the fence
  runs, body and closer unchanged, and the block is still `fencedCode`
- clearing the field and committing empties the info string
- typing a character after a commit lands it at the first body offset

## Edge cases

- source mode renders no chip at all
- a content-empty fence renders no chip in live
- Escape after typing into the field leaves the source byte-identical
- clicking away after typing into the field leaves the source byte-identical
- reading mode: a click on the chip opens no field
- a backtick committed into an UNCLOSED backtick fence's info string lands without it, and
  the block stays `fencedCode`
- one Mod+Z after a body character then a chip commit reverts the info string and keeps the
  character
- one Mod+Z after a chip commit then a typed character reverts the character and keeps the
  info string

## Miss-analysis

- Nothing could have caught this: the affordance did not exist. The class the suite missed
  is the one issue #142 names — a mode that hides a construct's syntax owes a door back to
  it, and only the link card had one. The presentation batteries assert what a mode HIDES
  and never asked what becomes unreachable when it does.
