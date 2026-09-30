# Feature: live-mode caret position after a structural landing (a caret placed by a mutation, not a step)

The rule for where typed bytes go reads the arrival that put the caret where it is
(`presentation-live-typing-affinity.md` holds the matrix of keystroke arrivals). A landing after
a structural change has no arrival key: the caret is put at a block's extreme by a mutation the
user drove from somewhere else, such as a Backspace at the next block's start or a list unwrap.
Live-mode § 4.2 makes an extreme relative to the construct, so a landing at a block end whose
last bytes are a construct's closer must put the caret outside it: the next byte typed continues
the paragraph, it does not join the construct the landing happened to touch. Driven on
`/test/editor` via `?presentationMode=live` with real keystrokes; each scenario checks the
source, since the byte position is the whole contract.

## Happy paths

- Backspace at a fence's first offset lands the caret at the previous paragraph's end, and a
  byte typed there lands after the closing `**` (`A **bold**` + `x` = `A **bold**x`)
- the same landing leaves the fence intact: the exit keypress deletes nothing

## Edge cases

- a paragraph whose last bytes are not a construct types plainly after the same landing, which
  is what shows the first scenario measures where the byte goes rather than the merge

## User interactions

- Real clicks and real keystrokes only: where the byte goes is decided inside the keydown
  dispatch, and a programmatic caret write would bypass it
- The landing is never asserted through the affinity state, which is editor-internal, but only
  through the caret's reported block and the bytes the next keystroke writes

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e
  fixture)

## Miss-analysis (#172)

The e2e coverage for caret affinity is a matrix of keystroke arrivals: every scenario reaches
its edge by stepping, clicking, or typing. A caret placed by a mutation is a fourth class of
arrival with nothing producing it, and no spec ever typed the first byte after a structural
landing, so the class was invisible because nothing in the suite ever arrived that way.
