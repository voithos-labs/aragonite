# Feature: Text Editing — Edge Cases

Boundary behavior for Enter/Backspace and kind-change reversals.

## Edge cases

- Enter at offset 0: covered by enter-at-block-start.md
- Backspace at start of first block: does nothing (no previous block to merge with)
- Backspace at start of a heading whose predecessor cannot absorb it: does not merge (the pair
  is ineligible either way round — heading above heading, and prose above prose-absorber), and
  the caret lands at the end of that predecessor. The caret IS the outcome here: source and
  block count are unchanged by construction, so a probe reading only those sees a dead key
- heading absorbs following paragraph on merge: Backspace at start of paragraph after heading merges into heading
- Backspace after thematic break: focuses the break (whole-block focus), no byte change; a second Backspace deletes it
- kind change reversal: deleting the # prefix from a heading reverts to paragraph
- split heading at middle: first block stays heading, second becomes paragraph (no marker duplication)
- Enter at end of heading: heading unchanged, new empty paragraph created — and it is in the bytes, so reloading them shows the same two blocks rather than a heading with trailing whitespace
