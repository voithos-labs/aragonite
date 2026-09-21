# Feature: a render-primary fold writes back only what its reveal measured (#161)

A render-primary leaf shows its source, holds the edit in DOM the tree never sees, and commits
once on blur. Undo and a host `source` swap both replace the node at that index before the blur
arrives, destroying the component and firing `focusout` on its way out, so the bytes being
written back belong to a block that is no longer there.

The block also answers chords in both states: the rendered view is where it spends most of its
life, and a view wired only for the click that shows the source swallows every chord that
reaches it, undo included. Mermaid's container handler is the model.

Fixture: `/test/plugins?seed=mathblock`.

## Happy paths

- Show the source, edit it, blur: the edit commits as one undo entry
- Mod+Z with the rendered view focused undoes that entry
- Mod+Z with the shown source focused undoes it too

## Edge cases

- `$$` and Enter creates a math block with the caret in its shown source. Mod+Z there walks the
  typed draft back one burst of typing per press, since the draft batches on the same pause the
  document does, and the press after the last one brings the paragraph back rather than moving
  the document forward with the draft
- Repeated Mod+Z keeps walking back, and no press is swallowed

## Miss-analysis

- The draft's own stack pushed an entry per splice while the document batched typing on a pause,
  so every scenario that typed more than one character undid one character at a time and nobody
  read that granularity as a defect.
- The only check before writing back was whether the text had changed, read at that moment, so
  every case that showed a source did it over a document that stood still. The question the
  check exists to answer, whether the block it measured is still the block at this index, was
  never asked, and both ways the block can move destroy the component, so no case asserting
  bytes alone could have seen it. The chord half was pinned on the shown source only, so the
  rendered view went its whole existence with no keydown handler and nothing to notice.
