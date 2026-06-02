# Feature: Blockquote Navigation — Exit on Empty Trailing Line

Pressing Enter on the empty trailing paragraph of a blockquote exits the quote
instead of appending another inner line. The exited source must collapse the
empty continuation marker — symmetric across nesting depth.

## Happy paths

- Top-level quote: Enter on the empty trailing line drops the cursor below the quote; the source has no stranded empty `>` line.

## Edge cases

- Nested quote (depth 2): exiting the inner quote rebuilds the outer quote's raw; no stranded empty `> >` line survives. (Regression — found by the note-taking simulation: the inner quote rebuilt its own raw but left the ancestor outer quote's raw stale, leaking `> >`.)
- Deeply nested quote (depth 3): exiting the innermost quote rebuilds the full ancestor chain; no stranded `> > >` line survives. Discriminates a full-chain rebuild from a one-level patch.
- After any exit the source round-trips (`serialize(parse(source)) === source`).
