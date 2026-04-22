# Clipboard: Partial List Selection Round-trip

Partial (mid-word) selection within a list, copy, and paste. A Ctrl+C → Ctrl+V round-trip reconstructs the original list structure exactly — no nested sub-list, no content loss.

## Happy paths

- Mid-one to end-of-three (`o|ne` through `three|`), Ctrl+C+V: document is identical to the original.
- Mid-one to mid-three (`o|ne` through `thre|e`): pre-selection residue reattaches cleanly; document round-trips.
- Cross-list-item partial selection (only two items involved): structure preserved.

## Mechanism

1. Copy includes the start item's container marker when the selection starts mid-item (symmetric to the existing end-side partial-marker behavior), so the clipboard parses as a proper list instead of a single paragraph with list-continuation lines (CommonMark §5.2 keeps bare "2." / "3." from interrupting paragraphs).
2. Paste detects "clipboard is a list, matching ancestor is a list, target descendant is non-empty" and merges the first clipboard item's content into the target leaf at the caret, splicing remaining items as siblings. Residual trailing characters from the pre-paste delete reattach to the last spliced item.
