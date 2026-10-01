# Feature: a draft held outside the document across a source swap

Some edits live outside the document until they commit: a shown block-math or inline-formula
source, a diagram's edit box. Each one was opened on one document, so a `source` swap drops it.
The block that held it is torn down by the swap, and that teardown blurs it, so without the rule
the blur would write the old document's draft over whatever block sits at the same place in the
new one. Driven on `/test/plugins` with real clicks and typing; the swap goes through the test
bridge's `setSource`, the way a host loads another note.

## Happy paths

- block math: a shown `$$x^2$$` source with typing in it, then a swap: the next document is
  exactly what was loaded, and no `edit` fires
- inline formula: the first formula of a two-formula line shown and typed into, then a swap:
  the same
- diagram: the edit box open with a line typed into it, then a swap to a document with another
  diagram at that place: that diagram keeps its own code, and no `edit` fires

## Edge cases

- a mode change with a shown block-math source still saves it, once: the switch's blur commits,
  the document holds the typed source, and exactly one `edit` fires

## Miss-analysis

- Every reveal and edit-box row closed its draft with a click, Enter or Escape on the same
  document. No row left one open across a swap, and the swap rows never opened one, so a blur
  that fires after the swap had nothing to land in.
