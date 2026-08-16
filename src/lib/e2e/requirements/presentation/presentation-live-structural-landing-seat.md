# Feature: live-mode seat after a STRUCTURAL landing (a caret placed by a mutation, not a step)

The typing seat reads the arrival that put the caret where it is
(`presentation-live-typing-affinity.md` holds the keystroke-arrival matrix). A structural
landing has no arrival key: the caret is seated at a block's extreme by a mutation the user
drove from somewhere else (a Backspace at the next block's start, a list unwrap). Live-mode
§ 4.2 makes an extreme construct-relative, so a landing at a block END whose last bytes are a
construct's closer must seat OUTSIDE it — the next byte typed continues the paragraph, it does
not join the construct the landing happened to touch. Driven on `/test/editor` via
`?presentationMode=live` with real keystrokes; the assertion is the SOURCE, since the byte
position is the whole contract.

## Happy paths

- Backspace at a fence's first offset lands the caret at the previous paragraph's end, and a
  byte typed there lands AFTER the closing `**` (`A **bold**` + `x` = `A **bold**x`)
- the same landing leaves the fence intact: the exit press deletes nothing

## Edge cases

- a paragraph whose last bytes are NOT a construct types plainly after the same landing, which
  is what says the seat, not the merge, is what the first scenario measures

## User interactions

- Real clicks and real keystrokes only: the seat is decided inside the keydown dispatch and a
  programmatic caret write would bypass it
- The landing is never asserted through the affinity state, which is editor-internal — only
  through the caret's reported block and the bytes the next keystroke writes

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e
  fixture)

## Miss-analysis (#172)

The affinity's e2e coverage is a matrix of KEYSTROKE arrivals: every scenario reaches its edge
by stepping, clicking, or typing. A caret seated by a mutation is a fourth arrival class with
no producer at its door, and no spec ever typed the first byte after a structural landing —
the class was invisible because nothing in the suite ever arrived that way.
