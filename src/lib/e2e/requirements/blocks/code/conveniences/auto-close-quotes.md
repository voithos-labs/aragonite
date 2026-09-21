# Feature: Code Block, Auto-Close Quotes

Quote pairs follow the same auto-close rules as brackets, and are suppressed as well when an identifier char sits on either side.

## Auto-close quotes

- Typing `'`, `"`, or `` ` `` with a collapsed cursor inserts the matching quote pair
- Auto-close is suppressed when either the next or the previous character is an identifier: `don|t` + `'` inserts only `'` (the apostrophe case), and `'don|` + `'` also inserts only `'` (closing an open string)
- A typed quote with a non-empty selection wraps the selection
