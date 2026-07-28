# Feature: Cross-block delete — container survivor caret

When a table-aware cross-block delete consumes every block the caret could land
in, the caret falls to the nearest surviving block before the range. A container
survivor (blockquote / list) must resolve to the END of its deepest focusable
leaf — never a char offset on the container's own path, which names bytes no leaf
owns and makes the restore clamp or mis-land.

## Happy paths

- Blockquote (multi-paragraph) followed by two tables; select from the first
  table through document end so both tables are consumed; delete: the blockquote
  survives and the caret lands at the end of its last paragraph. Typing a
  character appends it to that last paragraph (`> bravoX`), not elsewhere.

## Edge cases

- The survivor is a container, so a naive "end of the survivor's raw" caret would
  address the whole container's raw (nested markers included). The typed
  character must still land in the last leaf, proving the descent.
