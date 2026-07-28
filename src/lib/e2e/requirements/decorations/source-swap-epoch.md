# Feature: decorations survive a whole-document `source` swap

A consumer that reads `getSource()`, transforms the Markdown and writes the result
back through the `source` prop replaces the whole document. That is a document
change like any other, so the edit epoch must advance and every registered
decoration source must re-provide against the new document — otherwise a source
memoized on `editEpoch` (the shape the plugin guide publishes as the recipe) keeps
serving the previous document's decorations, painting marks into blocks that no
longer hold the word.

Scenarios run on `/test/plugins?seed=hloccur-memo` with highlight-occurrences
active, driving the swap through `window.__test.setSource` — the real prop write a
consumer performs. `window.__hloccurScans` publishes the plugin's index-rebuild
count, so "the swap rebuilt the index" is a counter assertion, not a timing guess.

## Happy paths

- swap to a document whose matching word lives in a different block, then caret
  that word: every mark paints in the NEW document's blocks, none in the block the
  old document had them in
- the swap rebuilds the memoized index (`__hloccurScans` increases), so the marks
  come from a scan of the new document rather than the cached one

## Edge cases

- swap to a SHORTER document (one block) holding a word the previous document never
  had, and caret it: every occurrence paints, where an index that was not rebuilt
  has no entry for the word and paints nothing
- two swaps in a row: the marks come from the NEWEST document, not the intermediate
  one (a signal that fires only on the first swap would show the intermediate)
- marks clear on the swap itself, before any new caret is placed (the reset drops
  the selection, so the source has no anchor)
