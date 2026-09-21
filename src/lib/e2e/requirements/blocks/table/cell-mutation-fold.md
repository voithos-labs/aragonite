# Feature: a cell mutation collapses its open reveal first

A revealed inline source inside a table cell is DOM that exists for the moment and that the CST
has never seen. Every mutation of the cell either rebuilds the whole row from the cells' `raw`
(the axis commands, the row insert) or commits `node.raw` underneath the reveal (the format
toggles, the line break, the menu's cut and paste), so a mutation that runs without collapsing
the reveal first either drops the user's edit or leaves the reveal open over bytes it no longer
matches. The prose block already collapses its reveal where commands are dispatched; the cell
carried the rule at its Enter case and its clipboard scaffolding only.

Fixture: `/test/plugins?seed=mathtable`, a two-column table whose body cell holds `$x^2$`.

## Happy paths

- Reveal `$x^2$`, type into it, run the insert-row-below chord: the typed bytes are in the
  document and the new row is there
- Reveal, type, toggle bold: the typed bytes commit, and the toggle acts on the committed text

## Edge cases

- The Enter case and the collapse on focus leaving belong to `cell-inline-reveal.md` and are not
  repeated here
- The round trip holds across each: a dropped edit leaves a well-formed document, so the bytes
  are the only thing that can see it

## Miss-analysis

- The rule was pinned on the two paths that already carried it, and every other case that drove a
  cell mutation drove it with no reveal open, so the rule read as enforced while three sibling
  paths ran straight past it. The table rebuild that discards the edit leaves the document
  well-formed, which is why neither the round-trip check nor the convergence check could see it
  either.
