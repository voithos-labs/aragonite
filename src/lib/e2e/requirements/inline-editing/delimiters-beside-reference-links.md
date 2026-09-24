# Feature: Inline Editing, Delimiters Beside a Reference Link

A reference link draws as a link only with the document's definitions, so the bold toggle and the delimiter auto-pair read the line with them too.

## The bold toggle

- Mod+B over a selection from inside a reference link's text to the line end writes nothing, the way it does beside an inline link (regression: the toggle wrote `see [te**xt][ref] here**`; miss-analysis: every toggle scenario used inline links, which read the same with or without the definitions)
- Mod+B over a selection from before a reference link into its text writes nothing (regression: `s**ee [te**xt][ref] here`)
- Mod+B over the same two selections beside an inline link writes nothing
- Mod+B over a whole reference link wraps it in \*\* markers

## The delimiter auto-pair

- A `*` typed before a `*` inside a reference link's text is written, not stepped over as the closer of a `*` before the link (regression: the typed `*` was lost; miss-analysis: the auto-pair scenarios typed beside inline links only)
