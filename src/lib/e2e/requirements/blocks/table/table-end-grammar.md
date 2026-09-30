# Feature: where a table ends, read in the editor's grammar

A table takes every line under its rows as one more row until a blank line or a line that opens
another block (GFM example 201). What opens a block is the editor's grammar: the plugins it lists
and the syntaxes it switched off. An opener that needs a later line to open, like a `$$` block
and its closing line, is read over the lines below, not the one line alone.

Miss-analysis: every table-boundary scenario used a one-line built-in opener under the default
grammar, so a check that read one line with no grammar was never contradicted.

## Happy paths

- `$$`, `x`, `$$` right under a table, with the latex plugin installed: the table ends and the three lines load as one math block

## Edge cases

- typing in a table cell rewrites the table and leaves the math block's bytes exactly as they were, with no blank line added between

## User interactions

- a real click into a body cell, End, then a typed key

## Error cases

- zero `[invariant:…]` console fires (automatic via the shared e2e fixture)
