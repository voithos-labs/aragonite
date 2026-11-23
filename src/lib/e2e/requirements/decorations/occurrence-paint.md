# Feature: highlight-occurrences, painted where the words are

With the caret on a word, highlight-occurrences marks every whole-word occurrence of it in
the blocks of prose. Each mark is an overlay over its word, measured here against the
painted text itself. Scenarios run on `/test/plugins?seed=hloccur`, each loading its own
document; the timing rows freeze the page clock once the marks are up.

Miss-analysis: the marks were counted, and aligned only in one block that never scrolled;
no row asked whether a block windowed in later is painted over its words, and the pause
was pinned on a burst of keys with no edge on either side of 250 ms. That is how 0.11.5
shipped with no mark on a block a scroll brings in.

## Happy paths

- A scroll paints what it brings in: in 400 paragraphs with `target` every 25th, the caret
  on the first `target` marks it; scrolled to the end, every `target` on screen has one
  overlay edge for edge and no overlay stands anywhere else.
- A table cell either way: the caret on `cat` in a paragraph marks the two `cat`s in the
  table's cells; the caret on the first cell's `cat` marks the paragraph's. Every overlay
  covers its word.

## Edge cases

- The first key hides them: with three marks up, one typed space leaves none at 50 ms and
  at 200 ms; at 300 ms they're back, three of them.
- A new document brings them back at once: after a typed key hid them, the source is
  replaced and the caret clicked onto `cat`; 50 ms later both `cat`s are marked, well
  inside the pause the key started.
