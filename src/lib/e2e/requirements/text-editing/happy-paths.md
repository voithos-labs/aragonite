# Feature: Text Editing, Happy Paths

Core editing: typing, splitting (Enter), merging (Backspace), and block kind changes.

## Happy paths

- typing appends to block: `typeText` at end of paragraph updates source
- Enter at end splits block: creates new empty block after current
- Backspace at start merges with previous: two paragraphs become one, content concatenated
- typing # prefix converts paragraph to heading: `typeText('# ')` at start changes kind

## User interactions

- rapid split: press Enter twice quickly, verify three blocks exist
- Backspace mid-block does not merge: Backspace at offset > 0 deletes a character, does not trigger merge
