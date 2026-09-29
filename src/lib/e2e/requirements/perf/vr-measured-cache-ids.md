# Feature: Virtual rendering, a swap leaves no dead ids in the measured cache

The editor remembers every block's measured height by the block's id (the
measured cache). Swapping the `source` prop replaces the whole document, so it
empties the cache, and every block of the new document gets a fresh id. What
could go wrong: a top-level list mounts and measures in the swap's first
flushes, and writes its height under an id from the old document, which nothing
will ever read again.

Driven on `/test/editor` over a windowed document with a list forty paragraphs
down. The page mirrors every id the cache is given, from the first swap on,
and compares them against every id the new document holds, top level and
nested.

Miss-analysis: a list's upward height report took its id from the parent's
table instead of from the block that measured, and no test ran a swap with a
list mounting right after it; the one unit test checked the table's id on a
plain array no real list has.

## Happy paths

- load a document, scroll until the list mounts and measures, leave it just
  above the viewport's top, then swap in a second document: every id the cache
  holds belongs to the second document, and the list's own id is among them
  (already green before the fix for issue #224; it stays so the bug can't come
  back quietly)

## Error cases

- no page errors surface during the swaps or the scroll
