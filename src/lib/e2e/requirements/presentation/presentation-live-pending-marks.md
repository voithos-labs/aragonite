# Feature: live-mode pending marks (a collapsed-caret toggle with no bytes)

Source mode and the preview modes paint the delimiter a `Mod+B` at a collapsed caret inserts, so
the user can see the empty `**|**` they made and the second keypress that removes it. Live paints
nothing, so the same pair is invisible garbage the moment the user walks away from it. In live
the chord therefore writes no bytes: it holds a mark pending, and the first insertion after it,
keystroke or IME commit, carries that mark into the bytes as one commit. The mark is resolved
against the constructs the caret sits inside, so a kind they lack wraps the insertion and a kind
they carry escapes it. Driven on `/test/editor` via `?presentationMode=live` with real chords,
real keystrokes, real clicks and a real CDP composition; each scenario checks the source, plus
the rendered element where "renders bold" is the claim.

Miss-analysis (undo granularity): the suite pinned one entry per commit only for structural
operations, which break the keystroke batch through the commit sequence. A format toggle shares
`updateBlockContent` with typing, so it merged into the surrounding burst and nothing
contradicted it; the row below is what would have.

Miss-analysis (the mark handed back): every scenario ended at the byte that spent the mark, so no
scenario ever deleted that byte and asked what the caret was formatted as afterwards. The chord
suite and the destructive-key suite each covered their own gesture and nothing ran the two in one
sequence.

## Happy paths

- `Mod+B` at a collapsed caret then a keystroke: the byte lands wrapped, `**X**` in the source,
  and the character renders inside a `strong` element
- `Mod+B` then `Mod+I` then a keystroke: both marks ride the one insertion, `***X***`
- a mark pended inside existing bold removes it: the byte escapes the construct, by splitting it
  closed and reopened where that parses back correctly and by stepping outside it where it does
  not

- `Mod+Shift+X` then a keystroke writes `~~X~~`, and `Mod+E` then a keystroke writes a backtick
  pair: the two marks whose delimiters no earlier scenario ever wrote
- two marks nest outermost first whatever order the chords arrived in: `Mod+B` then `Mod+E` and
  `Mod+E` then `Mod+B` both write ``**`X`**``, never a code span with literal stars inside it
- a mark pended inside a struck phrase removes it exactly as bold's does, by splitting it closed
  and reopened
- the insertion that spends a mark is its own undo entry: one `Mod+Z` after a burst plus a
  toggle plus a keystroke returns the burst's text, not the empty block

- un-bolding at the space inside a bold phrase brings no delimiter on screen: the split
  `**hello**X** world**` reads right but renders literal stars (a closing run before a space is
  not left-flanking), so the resolver re-parses its own candidate and steps outside instead, and
  the user sees one plain character and a phrase still entirely bold
- where a removal steps outside, it uses the construct edge nearer the caret (ties go to the
  leading edge). The policy is deliberate: the byte has to leave the construct, and leaving by
  the nearer edge is the smaller jump from where the user was typing

- a mark pending beside an atomic inline widget writes the wrapped byte on the side the caret
  is on and leaves the widget whole: the dispatcher hands a plain key to the marks handler before
  the widget handler sees it, and the rewrite is checked against the render path, so a splice that
  would change painted text is declined

## Edge cases

- `Mod+B` then click away: the source is byte-identical to before the chord, since the empty pair
  the other modes create is exactly what live must never write
- the mark is spent by one insertion: the second keystroke extends the construct the first one
  made, by the ordinary arrival rule, rather than wrapping a second pair of its own
- an arrow step clears the mark: the caret moved, so the promise no longer applies to it
- a click clears the mark, the same way it clears the arrival side
- a host `setSelection` clears the mark as a click does: the next keystroke types plain where
  the host put the caret
  - Miss-analysis: every clearing scenario was a key or a click, so the restore shared by
    `setSelection` and every other programmatic placement never met a pending mark

- a press that empties the construct a mark just made hands that mark back: after `Mod+I`, a
  letter and a Backspace, the next letter is still italic. The delimiters went with the letter,
  but the caret did not move, so the format it was typing in is still the format it is in
- the handed-back mark is a toggle like any other: `Mod+I` after that Backspace turns italic off,
  and the next letter types plain, which is what the preview modes give from their visible empty
  pair

- a mark Markdown cannot express at this caret writes nothing: where no candidate parses back to
  what was asked, whether an escape that would have to cut a link open or a wrap whose delimiters
  would merge with the run beside them, the byte types plain rather than showing a delimiter.
  § 1's "markers are never visible" outranks the toggle taking effect
- a mark applied inside a URL declines the same way: an autolink is one childless span, so a
  wrap inside it destroys the link and paints the angle brackets it was hiding. The byte types
  plain, the same bytes plain typing would write, and marking on either side of the URL still
  works

## IME commits

- a composition committed after `Mod+B` lands wrapped, exactly as a keystroke would: the composed
  run is the insertion the mark was pending for

## User interactions

- Real chords, keystrokes, clicks and a real CDP composition only: the mark is set where commands
  run and spent inside the keydown dispatch and the one call every composition goes through, and
  a programmatic write would bypass both
- The mark state is editor-internal and never asserted directly; every scenario reads the
  bytes it produced

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e
  fixture)
