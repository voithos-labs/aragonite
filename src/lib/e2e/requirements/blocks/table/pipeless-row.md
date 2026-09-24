# Feature: a line with no pipe after a table's rows

GFM reads a line straight after a table's rows as one more row when it opens no other block (spec example 201): its text is the row's first cell, and the row has the header's column count.

## Happy paths

- Loading `| a | b |\n| --- | --- |\n| 1 | 2 |\nPara one.\n`: one table with two body rows; the last row shows `Para one.` in its first cell and an empty second cell
- Typing at the end of that row's first cell: the typed character lands in the cell, the table's rows are written back with pipes, and the source reloads as the tree the editor holds

## Miss-analysis

- GH #439: the table parser stopped at the first line with no pipe, every table pin gave the line below a table a pipe or a block marker, and the four paste-in pins that looked converged leaned on that reading.
