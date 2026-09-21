# Feature: Virtual rendering, a remount measures the rendered block, not the mount flush

A block host mounts empty and its block component fills it in a later effect
of the same flush, so a height read inside that flush measures one line of
nothing. The batched measure pass reads a newly registered host only after the
flush that registered it, still before paint. Otherwise that passing height reaches
the height table, and where the block sits above the block held in place the scroll
is corrected for it and corrected back a frame later when the observer reports the real
height: two writes mid-wheel where none was needed, felt as a jerk.

Driven on `/test/plugins` (the route that renders inline math) in source mode,
over sections of a two-line paragraph, a blockquote of two more, a fence and a
list, with real wheel ticks over the editor's own scroll container and a count of
programmatic `scrollTop` writes taken at the editor's setter.

Miss-analysis: the windowing suites assert mounted counts and spacer geometry
after a scroll settles, and the anchor suites assert the correction for a
height that really changed; none counted the writes a scroll made, so a
correction undone a frame later read as a block held still.

## Happy paths

- real wheel ticks down through the document and back up never write the scroll:
  first mounts land below the held block, and a block re-entering above it
  at the height recorded on the way down needs no correction, the blockquote
  included, whose box is reported only after its children rendered

## Error cases

- no page errors surface during load or scroll
