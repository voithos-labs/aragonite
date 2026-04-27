# Feature: Table block — clipboard in (paste)

## Happy paths (inline)

- Paste plain text without `|` or `\n` into a cell: text appears at the caret.
- Paste plain text containing `|`: pipes auto-escape to `\|` in the cell raw.
- Paste plain text containing `\n`: newlines collapse to a single space; leading/trailing whitespace trimmed.
- Paste a single-paragraph clipboard (no blank-line separators): same rules as plain text — single-paragraph clipboards take the inline path.

## Happy paths (structural)

- Paste a markdown table into a body cell: original table splits at the paste row; pasted table is inserted between the halves.
- Paste a heading into a body cell: original table splits; the heading appears between the halves.
- Paste a multi-block clipboard (paragraph + heading): all blocks are inserted between the halves in order.

## Edge cases

- Paste at the header row (row 0): the paste-row goes to the first half — first half is the header-only table, pasted blocks follow, second half is the remaining body rows promoted.
- Paste at the last row: second half is empty; pasted blocks are appended after the original (which becomes the first half in full).

## User interactions

- A single Ctrl+Z undoes the entire paste — both inline and structural variants.

## Notes

- "Paste with multi-cell rectangular selection" and "Paste with whole-table selection (Ctrl+A 2nd press)" are deferred: they require cell-aware drag selection / 2nd-press cross-block state to be wired into the paste preDelete contract, which is outside Plan 5 scope.
