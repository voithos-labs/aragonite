# Feature: caret-driven decorations clear when the caret leaves the document

A decoration source that computes its marks from the caret (the highlight-occurrences
recipe the plugin guide publishes) recomputes on `selectionChange` and on nothing else.
So every gesture that ends the document caret has to reach that channel, including the
ones that leave no range behind for the browser to report: selecting an image widget
removes the native range outright, and the `selectionchange` the browser fires for it
carries no range at all. A gesture that stays silent there leaves the marks painted over
a word no caret sits on any more.

Scenarios run on `/test/plugins?seed=hloccur-memo` with highlight-occurrences active.
The image overlay portal is the only externally-observable signal of widget-selected
state, so it is what "the caret left for the widget" asserts against.

## Happy paths

- caret a repeated word, then click an image widget in the same document: the widget
  enters selected state and every occurrence mark clears

## Edge cases

- the marks clear without any new caret being placed — the gesture itself is the signal,
  not the next click
