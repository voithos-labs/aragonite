# Feature: Text Editing — Happy Paths

Core editing: typing, splitting (Enter), merging (Backspace), and block kind changes.

## Happy paths

- typing appends to block: typeText at end of paragraph updates source
- Enter at end splits block: creates new empty block after current
- Enter in middle splits content: text before cursor stays, text after moves to new block
- Backspace at start merges with previous: two paragraphs become one, content concatenated
- typing # prefix converts paragraph to heading: typeText('# ') at start changes kind
