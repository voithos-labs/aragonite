# Feature: details terminator escape on a join

Joining two lines in a `<details>` body can spell the closing tag out of two halves that each looked harmless (`</det` and `ails>`). The joined line has to land escaped (`&lt;/details>`), the same as a typed or pasted tag, or the container closes early when the document reloads.

Miss-analysis: the escape was tested on typing, Enter, a range delete and paste, but no test joined two whole blocks inside a details body, and both joins wrote their bytes without the body's rule.

## Happy paths

- Backspace at the start of `ails>`: the two lines join as `&lt;/details>`, the document still reads as one details block, and the source round-trips
- Delete at the end of `</det`: the same join and the same escaped line
