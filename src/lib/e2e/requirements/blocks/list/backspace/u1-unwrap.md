# Block: List — Backspace (Rule U1 — unwrap on first item)

Backspace at offset 0 of a non-empty first item lifts the item's paragraph out of the list as a plain paragraph; nested sub-lists react per type-matching rules; ordered markers renumber.

## U1 unwrap

- Backspace at start of non-empty first item (top-level): the item's paragraph becomes a plain paragraph before the list; matching-type nested sub-list items promote to the shrunk parent list level (renumbered for ordered lists); mismatched-type nested sub-lists become separate blocks between the lifted paragraph and the shrunk list. If removing the first item empties the list, the list is deleted. Cursor lands at offset 0 of the lifted paragraph. No auto-merge with the block above the list.

### Ordered list numbering on U1

- U1 unwrap of the first item in a list that follows a blank-separated prior list preserves the unwrapped list's original starting number on the remaining items (Google Docs semantics: the two visual lists read as one continuous sequence, with the lifted paragraph acting as a description between them — not Obsidian's restart-at-1)
