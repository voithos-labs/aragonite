# Feature: a cell mutation folds its open reveal first

A revealed inline source inside a table cell is ephemeral DOM the CST has not seen. Every mutation
of the cell either re-derives the whole row from cell `raw` (the axis commands, the row insert) or
commits `node.raw` beneath the reveal (the format toggles, the line break, the menu's cut/paste) —
so a mutation that runs without folding either drops the user's edit or strands the reveal open
over bytes it no longer matches. The prose surface already folds at its command seam; the cell
carried the rule at its Enter carve-out and its clipboard skeleton only.

Fixture: `/test/plugins?seed=mathtable` — a two-column table whose body cell holds `$x^2$`.

## Happy paths

- Reveal `$x^2$`, type into it, run the insert-row-below chord: the typed bytes are in the
  document and the new row is there
- Reveal, type, toggle bold: the typed bytes commit, and the toggle acts on the committed text

## Edge cases

- The Enter carve-out and the blur fold are `cell-inline-reveal.md`'s, not repeated here
- The round trip holds across each: a dropped ephemeral edit leaves a well-formed document, so
  bytes are the only oracle that sees it

## Miss-analysis

- The rule was pinned on the two paths that already carried it, and every other case that drove a
  cell mutation drove it with no reveal open — so the rule read as enforced while three sibling
  seams ran straight past it. The table rebuild that discards the edit leaves the document
  well-formed, which is why the round-trip and convergence oracles could not see it either.
