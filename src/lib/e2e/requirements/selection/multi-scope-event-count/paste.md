# Feature: One Edit Event per Op, Paste

A paste is one commit and one edit event. A paste over a range across blocks is two: the range's removal, then the paste.

## Routes covered

- Blocks pasted at the end of a list item's text: exactly one edit event.
- A list pasted over a list item's whole text: exactly one edit event.
- A list pasted over a range across two list items: exactly two edit events, the removal then the paste. Each commit is one op.
