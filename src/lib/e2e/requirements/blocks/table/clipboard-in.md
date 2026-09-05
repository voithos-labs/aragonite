# Feature: Table block — clipboard in (paste)

## Happy paths (inline)

- Paste plain text without `|` or `\n` into a cell: text appears at the caret.
- Paste plain text containing `|`: pipes auto-escape to `\|` in the cell raw.
- Paste plain text containing `\n`: newlines collapse to a single space; leading/trailing whitespace trimmed.
- Paste a single-paragraph clipboard (no blank-line separators): same rules as plain text — single-paragraph clipboards take the inline path.
- Paste text a copy wrapped in blank lines: the blank blocks at either edge are packaging, so one content paragraph still takes the inline path and the table stays whole.

## Happy paths (structural)

- Paste a markdown table into a body cell: original table splits at the paste row; pasted table is inserted between the halves.
- Paste a heading into a body cell: original table splits; the heading appears between the halves.
- Paste a multi-block clipboard (paragraph + heading): all blocks are inserted between the halves in order.

## Edge cases

- Paste at the header row (row 0): the paste-row goes to the first half — first half is the header-only table, pasted blocks follow, second half is the remaining body rows promoted.
- Paste at the last row: second half is empty; pasted blocks are appended after the original (which becomes the first half in full).

## User interactions

- A single Ctrl+Z undoes the entire paste — both inline and structural variants.

## Multi-cell selection at paste

- Sub-rectangle selection + paste plain text: cells inside the rectangle are cleared; pasted text lands inside the anchor cell. Cells outside the rectangle remain untouched. Single Ctrl+Z restores the original document.
- Whole-table selection (Ctrl+A 2nd press) + paste a paragraph: the table block is removed and replaced by the pasted block(s) at the table's position. Single Ctrl+Z restores the original table.

## Miss-analysis

- Blank-line materialization turned a copy's whitespace-only edge lines into blocks, which moved
  an ordinary cell paste onto the break-the-table route; the sweep that followed the rule picked
  its e2e projects by the files it touched, so e2e-blocks never ran. Under it sat the real gap:
  the cell-paste family unit-tested its hooks and never the classification that chooses between
  them, so no unit run could see a cell target take the wrong route. Both now have pins
  (`dispatch-strategy.test.ts`, `cell-paste-classification.test.ts`).
