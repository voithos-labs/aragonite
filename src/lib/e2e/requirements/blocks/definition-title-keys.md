# Feature: Keys under a definition whose title has started

A link definition's title can start on a later line and run on over every line a paragraph
would run on to. Until it closes, the lines under the definition are blocks of their own. A key
in one of them can close the title, and then they are the definition's.

## Happy paths

- a quote typed under a started title closes it: `[a]: /u`, an indented `"code`, two more
  definitions and `end`; a `"` typed after `end` leaves one definition holding all five lines,
  with the caret after the quote
- undo gives the blocks back: the same key, then undo, leaves the five blocks and the bytes as
  they were

- Enter inside a title that runs over lines opens a blank line: `[a]: /u`, an indented `'code`,
  `text`, `end'` is one definition; Enter after `/u` writes a blank line there, leaves the
  definition, the code and a paragraph, and puts the caret at the code's start

## Regressions

- Enter there wrote no byte and split the definition in the tree, three blocks for one.
  Miss-analysis: the split's rows cut blocks whose halves rejoin through the line right under
  the cut; none cut a block whose halves rejoin two lines further down

- the typed quote left five blocks where a reload reads one, with no dev check firing.
  Miss-analysis: every keystroke row put its key in the block it changes or right under an opener
  a line closes; none put a key several blocks under a reading no line closes
