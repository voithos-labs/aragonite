# Feature: Text Editing: Edge Cases

Boundary behavior for Enter and Backspace where the caret, the focus or the reload is the
outcome. What each gesture writes is pinned at the tree level.

## Edge cases

- Enter at offset 0: covered by enter-at-block-start.md
- Backspace at start of a heading whose predecessor cannot absorb it: does not merge (the pair
  is ineligible either way round: heading above heading, and prose above prose-absorber), and
  the caret lands at the end of that predecessor. The caret is the outcome here: the block
  count is unchanged by construction, so a test reading only the count sees a key that does
  nothing. The empty heading the caret leaves then demotes to an empty paragraph on blur, a rule
  of its own (the heading Enter and blur rules), so its bytes move without any merge
- Backspace after thematic break: focuses the break (whole-block focus), no byte change; a second Backspace deletes it
- Enter at end of heading: heading unchanged, new empty paragraph created, and it is in the bytes, so reloading them shows the same two blocks rather than a heading with trailing whitespace
