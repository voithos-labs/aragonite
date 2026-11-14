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

## Where the caret lands

Miss-analysis: every row stated the bytes alone, so none typed after a Delete whose range entered
a later container, where the caret stopped on that container's opening line.

- A note whose body starts with a table, a tip after it; select from the first cell into the tip's
  first line; Delete, then type a letter: the letter lands at the start of what is left of that
  line, not on the tip's `:::tip`. In live and source mode.

## A range ending at a line's end

Miss-analysis: every row ended mid-line, so none ended at a line's end inside a block that runs on,
where the removal wrote that line's quote marker in front of the next line's.

- A table, a paragraph, then a code block in a quote with two lines; select from the first cell to
  the end of the code's first line; Delete, then type a letter: the code's second line keeps one
  quote marker, and the letter lands at its start. In live and source mode.

## Enter over the range

Miss-analysis: every row here deleted or cut, so none pressed Enter over a range into a container,
whose removal kept the caret short of the text and whose key then landed on the tip's `:::tip`.

- A table, a paragraph, then a tip inside a note; select from the first cell into the tip's first
  line; Enter, then type a letter: both openings stay, an empty line comes before what is left of
  the tip's line, and the letter lands at its start. In live and source mode.

Miss-analysis: every Enter row pressed a key the block it ended in binds, and a title row binds no
Shift+Enter, so its break reached the range as input and took Backspace's side onto the opening.

- A table, a paragraph, then a tip with a title; select from the first cell into the title;
  Shift+Enter, then type a letter: an empty line opens above the tip, as Enter's does, and the
  letter lands there, never on the tip's `:::tip`. In live and source mode.
