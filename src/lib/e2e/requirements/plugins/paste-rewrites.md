# Feature: a paste rewrite by block type

A plugin value lists `rewrites`, each naming a block type and the Markdown that takes a pasted
block's place. The alerts plugin rewrites a pasted `%> [!TYPE]` alert to a `:::type` callout. Every
scenario runs on `/test/plugins?seed=alerts` with real clicks, keys and the system clipboard. The
order of rewrites, their depth, an empty answer and their cost are held by
`tree-operations/paste/paste-rewrites.test.ts`.

Miss-analysis: paste rewrites were process-wide text transforms run on each route by hand, and no
spec pasted the editor's own copy through Replace with clipboard, which rewrote it.

## Happy paths

- An alert pasted mid-paragraph lands as the callout its rewrite writes
- An alert pasted in a table cell lands rewritten below the rows above it
- Replace with clipboard rewrites an alert copied from outside

## Edge cases

- One alert line pasted after text stays text
- The editor's own alert, copied with Ctrl+C and pasted with Ctrl+V, keeps its bytes
- The editor's own alert pasted in a table cell keeps its bytes
- Replace with clipboard keeps the editor's own copy as it was

## Error cases

- none: this spec must trigger no invariants
