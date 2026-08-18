# Clipboard: List Copy-Paste Round-trip

Copy of a list selection pasted back over itself reconstructs the original structure exactly — no nested sub-list, no content loss. When the clipboard holds a list and the target is an empty list item whose outer list is the same kind, the pasted items flatten into the outer list rather than nesting; this is the classic markdown-editor round-trip expectation (Obsidian, Typora, VS Code markdown).

## Happy paths

- Mid-one to end-of-three (`o|ne` through `three|`), Ctrl+C+V: document is identical to the original.
- Mid-one to mid-three (`o|ne` through `thre|e`): pre-selection residue reattaches cleanly; document round-trips.
- Cross-list-item partial selection (only two items involved): structure preserved.
- 3-item ordered list, select items 1-2 whole, Ctrl+C+V: original 3-item structure restored.
- 2-item ordered list, select all, Ctrl+C+V: original 2-item structure restored.
- Unordered list round-trip: same behavior as ordered.
- Pre-staged clipboard of list content, paste over cross-block selection of entire target list: pasted items flatten at the outer level.

## Edge cases

- Ordered → unordered (mismatched kinds): falls back to nested paste. The flatten-on-match rule only fires for matching kinds.
- Non-empty target list-item: nested paste. The flatten rule only fires when the target's immediate container-child (the empty list-item from a preceding cross-block delete, or any pre-emptied item) has no non-whitespace content.

## Mechanism

1. Copy includes the start item's container marker when the selection starts mid-item (symmetric to the end-side partial-marker behavior), so the clipboard parses as a proper list instead of a single paragraph with list-continuation lines (CommonMark §5.2 keeps bare "2." / "3." from interrupting paragraphs).
2. Paste detects "clipboard is a list, matching ancestor is a list, target descendant is non-empty" and merges the first clipboard item's content into the target leaf at the caret, splicing remaining items as siblings. Residual trailing characters from the pre-paste delete reattach to the last spliced item.
