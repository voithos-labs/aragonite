# Feature: A range removal out of a container keeps its closing line in place

A selection that starts at a container's first block, taking that block whole, and runs out past
the container removes what it covers. The container's closing line stays, under what is left of
the container, above whatever followed it.

Miss-analysis: no drawn fenced container held a block a range takes whole from its first byte
(their bodies held paragraphs and `# head`), so no range left one from there with a block after it.

## Happy paths

- An open details whose body starts with a table, then a paragraph and a heading after it; select
  from the first cell to the paragraph's end; Backspace: the details stays, emptied, with its
  closing line, and the heading stays after it, outside the details. In live and source mode.
- A tip inside a note, the tip's body starting with a table, a paragraph in the note after the
  tip; select from the first cell to that paragraph's end; cut: the tip's closing line comes
  before the note's. In live and source mode.
