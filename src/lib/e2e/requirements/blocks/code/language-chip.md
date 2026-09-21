# Feature: the code block's language chip

A mode that hides markers paints no fence, and the caret cannot sit in a hidden run, so once
a fenced block has body content its info string can be neither read nor edited from inside
the mode (issue #142). The chip is the way back to it: the second use of the link card, over
the fence's info string instead of a link's destination.

## What the chip is

A button in the code block's side gutter at the top-right of the code box, showing the info
string's first word, or `text` when there is none. A click opens a picker below it: a search
field over every registered language, one row each, the block's own language highlighted first
in the spelling the fence uses. An alias (`rs`, `py`) is a search key rather than a row of its
own, so the list never holds a language twice. Enter commits what the field holds whenever that
spelling names a language the registry knows and the highlight has not moved, and the highlighted
row otherwise, which is also how a language the registry does not know can still be written
(§ The commit has the whole rule); `text` is the row that clears a language; Escape and clicking
away both cancel, byte for byte. Only Enter and a pick from the list write. A bare fence that has
just taken the caret with no language opens the picker itself, unless the caret stepped in from a
neighbour: moving through an existing fence with the keyboard is not the moment its author picks
a language, and a picker taking focus there would trap that movement.

It comes and goes rather than sitting there: hidden until the pointer hovers the block or the
caret sits inside it, following the same quiet-by-default rule as the drag handle. It renders
outside the contenteditable, as a sibling of the element the offset walk reads rather than a
child, so that walk never sees it and the render effect's `replaceChildren` cannot destroy it.

## Visibility

- The chip renders in the modes that hide markers (`reading`, both `preview-*` modes, `live`)
  when the block is not content-empty, and never in source mode, which always paints its
  fence.
- A content-empty block (an empty fence) gets the side gutter like any other. Its own dimmed
  markers paint only while the caret is inside (the caret's own walk applies the same test, and
  the two must not disagree), and the caret arriving completes the bare fence (opener, empty
  body line, closer) so there is a line to sit on, then opens the picker when the fence has no
  language: the picker is how a language gets written, and a fence with none is exactly where
  it is wanted.
- The chip shows on hover over the block or on focus inside it; an open field keeps it showing.
- The hover is the block's own, not its container's: a fence nested in a blockquote or a list
  item stays hidden while the pointer sits elsewhere inside that container.
- Reading mode shows the same chip, inert: a click opens no field, since the mode writes
  no bytes.

## The commit

- Only the info-string span of the opening fence line is rewritten. Indent, marker run,
  line ending, body and closer are byte-identical through the write.
- The write goes through the one call every display commit in the block uses (`commitDisplay`,
  G4.24), so the fence write rule runs over it like every other gesture, and it lands as one
  undo entry, kept apart on both sides, so neither a burst of typing before it nor one after it
  joins the entry.
- A typed spelling the registry resolves is a name, not a query: it commits as typed, so `rs`
  lands as `rs` rather than as the `rust` row it found. Moving the highlight (an arrow key, or
  the pointer over a row) makes that row win instead, and a spelling no grammar answers to
  commits as typed too, which is how a language the registry does not know can still be written.
- An info string that did not change closes the picker rather than writing: no undo entry, no
  `edit` event. What is compared is the value the field started with, not the bytes that would
  be written, because `meta.info` is trimmed: on a padded opener (trailing spaces after `js`, or
  spaces before it) comparing bytes would let a bare Enter rewrite the author's own spacing and
  create an undo entry for it. An info string that did change still writes on a padded line,
  tidying that spacing along with it.
- A commit and an Escape both return the caret to the block, at the first body offset. Clicking
  away does not: focus is already where the user just put it, and pulling it back is worse
  than leaving it (the rule `MermaidBlock` follows for the same shape). Where the caret ends up
  is pinned by typing a character, not by asking who has focus: a caret nowhere usable reports
  focus just as well as one that works.
- Navigation is not the way in here. `moveFocus` to the block's own index stops at the
  gap above it, so the caret is placed through the block's own `focus`.

## Bytes the info string cannot hold

The helper drops what would stop the line reading as this block's opener, in the one place
every caller goes through rather than at each caller. Dropping rather than refusing is the rule
the typed and pasted routes already share (`fence-content-validity.md`), so all three behave alike:

- A backtick in a backtick fence's info string is dropped (CommonMark §4.5), including on
  an unclosed fence, where the commit's own cleanup pass does nothing.
- A leading run of the fence's own marker is dropped: it would grow the run instead,
  re-reading `~~~` + `~~x` as a five-tilde fence its own closer no longer closes. The same
  marker later in the string is ordinary info text and survives.
- A line ending is flattened away, an info string being one line by construction.
- A tilde fence's info string may hold backticks, so nothing is dropped there.

## Known gaps

- **No keyboard chord.** v1 is pointer-first; claiming a chord before the 1.0 freeze is a
  bigger decision than this control. A Tab reaching the button works because the button
  is a button, which is as far as v1 goes.
- **Reading mode on an empty fence paints no markers, but still shows the gutter.** Showing a
  content-empty block's markers covers only `preview-*` and `live`, so an empty fence in
  reading mode shows none; the side gutter renders anyway, as an inert language label beside a
  copy button, which is what a reader can still use.
- **A focused preview block shows both.** The preview modes show the fence on the focused
  block, and the chip also shows there (the caret is inside, and an open field counts as
  inside). Redundant, harmless, and cheaper than teaching the chip to read the focus attribute.
- **The reading-mode chip is an enabled button that does nothing.** No `disabled`, no
  `aria-disabled`: the mode writes nothing anywhere, the label is the useful half, and a
  disabled control cannot be reached by the gesture that proves it does nothing. The
  `aria-label` still names the language, which is what a reader wants from it.
- **The undo scenarios cannot tell whether the entry was kept apart.** `isolateUndoEntry` is
  the right call and costs nothing, but a Playwright click between the typing and the commit
  already outruns the 250ms batching window, so both undo scenarios would pass without it.
  What they do pin is the outcome: one Mod+Z takes the info string or the character, never both.
- **Plugin fence kinds do not inherit it.** Mermaid and the math fence have their own
  components; the chip belongs to the built-in `fencedCode` component alone, with no descriptor
  field and no plugin API behind it.

## Happy paths

- each mode you can write in (`live`, `preview-inline`, `preview-block`), pointer over the
  block: the chip shows and reads `js`
- live mode, caret inside the block and the pointer away: the chip shows
- an empty info string reads `text`
- each mode you can write in: click, type a new language, Enter, and the source shows the new
  info string with the fence runs, body and closer unchanged, and the block is still
  `fencedCode`. The preview modes are the interesting ones: the open field makes the block
  count as focused, so they show the fence while the chip is committing over it
- typing an alias (`rs`) filters to its language, listed once under its canonical name, and
  Enter lands the alias as typed
- clearing the field and committing empties the info string
- typing a character after a commit lands it at the first body offset

## Edge cases

- source mode renders no chip at all
- a content-empty fence in live gets the side gutter with its markers hidden; clicking into it
  completes the fence, opens the picker, and Escape returns the caret to the new body line
- a bare Enter on a padded fence line leaves the source byte-identical, and the one Mod+Z after
  it reverts the edit made before the chip was opened
- a container's hover leaves its nested block's chip hidden; hovering that block shows it
- Escape after typing into the field leaves the source byte-identical
- clicking away after typing into the field leaves the source byte-identical
- reading mode: a click on the chip opens no field
- a backtick committed into an unclosed backtick fence's info string lands without it, and
  the block stays `fencedCode`
- a leading tilde run committed into a tilde fence's info string lands without it, and the
  heading below stays a sibling
- one Mod+Z after a body character then a chip commit reverts the info string and keeps the
  character
- one Mod+Z after a chip commit then a typed character reverts the character and keeps the
  info string

## Miss-analysis

- The commit that changes nothing: every commit scenario typed a new language onto an unpadded
  fence, so the byte comparison passed on the only shape the suite loaded and the gesture that
  changes nothing was never made. A control's do-nothing path is a scenario, not the absence of one.
- The doubled list (#322): every scenario read the picker through the commit it produced, so a
  list carrying a row per spelling instead of a row per language passed all of them. No test
  ever read the rows.
- Nothing could have caught this: the control did not exist. What the suite missed is the class
  issue #142 names: a mode that hides a construct's syntax has to give a way back to it, and
  only the link card had one. The presentation suites check what a mode hides and never asked
  what becomes unreachable when it does.
