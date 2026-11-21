# Feature: One Edit Event per Op, Paste

A paste is one commit and one edit event, over a range across blocks too: the range-edit core answers the removal and the paste as one.

## Routes covered

- Blocks pasted at the end of a list item's text: exactly one edit event.
- A list pasted over a list item's whole text: exactly one edit event.
- A list pasted over a range across two list items: exactly one edit event.
