# Feature: paste rewrites, by block type and of the whole paste

A plugin value lists `blockRewrites`, each naming a block type and the Markdown that takes a pasted
block's place, and `pasteRewrites`, each answering for the whole paste. The alerts plugin rewrites a
pasted `%> [!TYPE]` alert to a `:::type` callout, and shouts any paste with `!!` in it. Every
scenario runs on `/test/plugins?seed=alerts` with real clicks, keys and the system clipboard. The
order of rewrites, their depth, an empty answer and their cost are held by
`tree-operations/paste/paste-rewrites.test.ts`.

Miss-analysis: paste rewrites were process-wide text transforms run on each route by hand, and no
spec pasted the editor's own copy through Replace with clipboard, which rewrote it.

Miss-analysis: an insert row went in through the paste's entry point, and no spec picked a row whose own Markdown
a listed rewrite reads, so the alert's row inserted a callout.

Miss-analysis: a content rewrite was a process-wide transform run only where a paste lands as
blocks, and no spec pasted one line into text under one.

## Happy paths

- An alert pasted mid-paragraph lands as the callout its rewrite writes
- An alert pasted in a table cell lands rewritten below the rows above it
- Replace with clipboard rewrites an alert copied from outside
- One line with `!!` pasted after text shouts, as text on its line

## Edge cases

- One alert line pasted after text stays text
- The editor's own alert, copied with Ctrl+C and pasted with Ctrl+V, keeps its bytes
- The editor's own alert pasted in a table cell keeps its bytes
- The alert's own insert row lands the alert it wrote, not the callout its rewrite writes
- Replace with clipboard keeps the editor's own copy as it was
- A plain paste with `!!` keeps its case

## Error cases

- none: this spec must trigger no invariants
