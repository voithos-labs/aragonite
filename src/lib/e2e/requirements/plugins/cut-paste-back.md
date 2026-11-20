# Feature: a cut pasted straight back

A cut writes the editor's own entry beside its text, and a paste of it where the cut left the caret
puts the cut's bytes back. That holds wherever the caret landed: on the next block's text past its
syntax, or in the gap beside a block focused whole. Fixture: the `/test/plugins` harness, both
modes.

## Happy paths

- A range from a divider through a heading's end, a heading after, cut then Mod+V: the document comes back
- The same with a titled callout after: the document comes back, the title intact

## User interactions

- A divider focused whole at the end of an untitled callout, Mod+X then Mod+V: the document comes back
- A divider focused whole after a table of contents, Mod+X then Mod+V: the document comes back

## Miss-analysis

- Every put-back row cut where the removal's caret was also its landing, so none cut where the
  landing moved on past it (into a heading's text, a title), which the entry never fit.
