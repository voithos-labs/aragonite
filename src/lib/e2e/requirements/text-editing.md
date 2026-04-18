# Feature: Text Editing

Core editing: typing, splitting (Enter), merging (Backspace), and block kind changes.

## Happy paths

- typing appends to block: typeText at end of paragraph updates source
- Enter at end splits block: creates new empty block after current
- Enter in middle splits content: text before cursor stays, text after moves to new block
- Backspace at start merges with previous: two paragraphs become one, content concatenated
- typing # prefix converts paragraph to heading: typeText('# ') at start changes kind

## Edge cases

- Enter at offset 0: creates empty block before, original content moves to second block
- Backspace at start of first block: does nothing (no previous block to merge with)
- Backspace at start of heading after heading: does not merge (heading+heading ineligible), moves focus
- heading absorbs following paragraph on merge: Backspace at start of paragraph after heading merges into heading
- Backspace after thematic break: deletes the thematic break
- kind change reversal: deleting the # prefix from a heading reverts to paragraph
- split heading at middle: first block stays heading, second becomes paragraph (no marker duplication)
- Enter at end of heading: heading unchanged, new empty paragraph created

## User interactions

- type then check source: realistic flow of click → focusBlockEnd → typeText → verify getSource
- split then type in new block: Enter creates block, typing in new block updates source
- rapid split: press Enter twice quickly, verify three blocks exist
- Backspace mid-block does not merge: Backspace at offset > 0 deletes a character, doesn't trigger merge
