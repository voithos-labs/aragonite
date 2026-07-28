# Feature: Where Enter splices inside a fenced code block

Enter's newline lands on the body, never on a fence line. A caret on the opening
fence line clamps the newline to the body start, a caret inside the closing fence
text clamps it to the body end: the fence stays byte-intact, the body gains a blank
line, and the caret stays with the content — the same result Enter at that body edge
already produces. A splice before or inside the opener corrupts the raw (phantom
fence rendered from a leading `\n`); one inside the closer breaks the closer apart
and leaves an unclosed fence. With a selection, Enter replaces it on the selection's
body span, like every other ranged edit on this surface (`fence-ranged-edit.md`).

## Happy paths

- Enter at raw offset 0 of a closed fence: opener intact, blank first body line, typed text lands at the head of the body content
- Enter at raw offset 0 of an unclosed fence: same clamp, opener intact
- Enter inside the closer fence text: closer intact, blank last body line, block still `fencedCode` and round-trips
- Enter over a selection replaces the selected text with the newline

## Edge cases

- Enter mid-opener (inside the fence chars / info string): clamps identically to offset 0 — never splits the opener text
- repeated Enter at the top does not cascade: opener stays intact, no phantom fence, block still fencedCode and round-trips
- rendered text matches the raw (no phantom fence marker in the DOM)
- Enter over a selection reaching into the closer replaces only the body part; the fence survives

## User interactions

- Enter at the end of the opener line (unchanged behavior): blank first body line, caret on the blank line, typed text lands there
- Enter at the start of the closer line (unchanged behavior): blank last body line — that offset is already a safe splice point, so it stays unclamped
