# Feature: a block turned into text right under a table

A table takes any line straight below its rows that opens no other block as one more row (`pipeless-row.md`). A block an edit turns into text right under a table gets a blank line above it, the table's separator, so it stays a paragraph and the caret stays in it.

## User interactions

- Load `T> q\n` (`T` is a two-row table), Backspace at the start of the quote, type `W`: the source is `T\nWq\n`, a table then a paragraph
- Load `T> q | r\n`, Backspace at the start of the quote, type `W`: the source is `T\nWq | r\n`; the pipe does not make the line a row (GH #445)
- Load `T- x\n`, Backspace at the start of the item, type `W`: the source is `T\nWx\n`
- Load `T# Head\n`, caret at the end of the heading, Ctrl+0, type `W`: the source is `T\nHeadW\n`
- Load `T---\nnext\n`, Backspace twice at the start of `next`, type `W`: the source is `T\nWnext\n`
- After each of those edits, one undo gives back the loaded bytes

## Miss-analysis

- Every table pin put a blank line or a block marker under the table, so no test turned the block right under one into text; the table taking a line with no pipe as a row widened the loss from lines holding a pipe to every line of text.
