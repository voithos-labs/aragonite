# Feature: highlight-occurrences, painted where the words are

With the caret on a word, highlight-occurrences marks every whole-word occurrence of it in
the blocks of prose. Each mark is an overlay over its word, measured here against the
painted text itself. Scenarios run on `/test/plugins?seed=hloccur`, each loading its own
document; the timing rows freeze the page clock once the marks are up.

Miss-analysis: the marks were counted, and aligned only in one block that never scrolled;
no row asked whether a block windowed in later is painted over its words, and the pause
was pinned on a burst of keys with no edge on either side of 250 ms.

## Happy paths

- A scroll paints what it brings in: in 400 paragraphs with `target` every 25th, the caret
  on the `target` of block 200 marks it and its neighbours; a scroll of 600 px mounts block
  250, which comes in marked, and every `target` on screen has one overlay edge for edge
  with no overlay anywhere else. The scroll is short on purpose: a caret whose block is
  windowed out reads as no selection, which clears the marks.
- A table cell either way: the caret on `cat` in a paragraph marks the two `cat`s in the
  table's cells; the caret on the first cell's `cat` marks the paragraph's. Every overlay
  covers its word.

## Edge cases

- The first key hides them: with three marks up, one typed space leaves none at 50 ms and
  at 200 ms; at 300 ms they're back, three of them.
- A new document brings them back at once: after a typed key hid them, the source is
  replaced and the caret clicked onto `cat`; 50 ms later both `cat`s are marked, well
  inside the pause the key started.
