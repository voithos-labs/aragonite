# Feature: a render-primary fold writes back only what its reveal measured (#161)

A render-primary leaf reveals its source, holds the edit in ephemeral DOM, and commits once on
blur. Undo and a host `source` swap both replace the node at that index BEFORE the blur arrives —
the component is destroyed and the focusout fires on its way out — so the fold's bytes belong to a
block that is no longer there.

The block also answers chords in BOTH halves of the swap: the folded view is where it spends most
of its life, and a view wired only for the reveal click swallows every chord that reaches it, undo
included. Mermaid's container arm is the model.

Fixture: `/test/plugins?seed=mathblock`.

## Happy paths

- Reveal, edit, blur: the edit commits as one undo entry
- Mod+Z with the FOLDED render view focused undoes that entry
- Mod+Z with the revealed source focused undoes it too

## Edge cases

- `$$` + Enter mints a math block with the caret in its revealed source; Mod+Z there returns the
  paragraph rather than moving the document forward with the draft
- Repeated Mod+Z keeps walking back; no press is swallowed

## Miss-analysis

- The fold's only guard was "did the text change", read at fold time, so every case that drove a
  reveal drove it over a document that stood still. The question the guard exists to answer — is
  the block I measured still the block at this index — was never asked, and both ways it moves
  destroy the component, so no case that asserted only bytes could have seen it. The chord half
  was pinned on the revealed source alone, so the folded view went its whole existence with no
  keydown door and nothing to notice.
