# Feature: Code Block Enter on the Opener Fence Line

Enter with the caret on the opening fence line clamps the newline to the body
start: the opener stays byte-intact, the body gains a blank first line, and the
caret stays with the content — the same result Enter at body-line-1 start
already produces. A splice before or inside the opener corrupts the raw
(phantom fence rendered from a leading `\n`).

## Happy paths

- Enter at raw offset 0 of a closed fence: opener intact, blank first body line, typed text lands at the head of the body content
- Enter at raw offset 0 of an unclosed fence: same clamp, opener intact

## Edge cases

- Enter mid-opener (inside the fence chars / info string): clamps identically to offset 0 — never splits the opener text
- repeated Enter at the top does not cascade: opener stays intact, no phantom fence, block still fencedCode and round-trips
- rendered text matches the raw (no phantom fence marker in the DOM)

## User interactions

- Enter at the end of the opener line (unchanged behavior): blank first body line, caret on the blank line, typed text lands there
