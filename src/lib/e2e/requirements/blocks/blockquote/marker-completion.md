# Feature: Blockquote marker completion (the space that finishes `> `)

The blockquote opener fires on a bare `>`, so typing it in an empty paragraph creates the
quote at once and the caret lands in its empty child. The space a user types next is part
of the marker they are still writing, not content: it is swallowed, no byte moves and no
undo entry is pushed. `rebuildBlockquoteRaw` writes `> ` on every content line, so the
space appears on its own the moment content arrives. Lists already work this way: `-`
alone stays a paragraph, and the switch to a list writes `- ` whole.

The same holds in every mode: a blockquote's marker is drawn as a border in every
presentation mode, so live and source behave alike here.

## Happy paths

- Live mode, typing `>` then space then `a` in an empty paragraph yields `> a`, one space
  and not two, and the space on its own leaves the source byte-identical
- Source mode runs the same three keystrokes to the same `> a`
- Typing `>`, space, `>`, space, `a` nests: the inner quote completes at its own depth and
  yields `> > a`

## Edge cases

- Any empty child completes the same way wherever it sits (first, middle or last, made by
  an Enter or loaded with the document): the space is swallowed there too, so the following
  character lands as `> x` rather than `>  x`
- Only the first space at a given empty child completes the marker. A swallowed space writes
  nothing, so the child looks the same before the second one as before the first, and only the
  dispatcher's own memory tells them apart; the second space lands as ordinary content, which
  is what lets leading whitespace and the indented-code opener be typed in keystroke order.
  "Given child" means the CST node, so a child the editor made again (typing content and
  deleting it back to empty) treats its next space as a completion once more: a bare `>` line
  always reads the same way. The middle position and the refusal on the second space are
  pinned at the dispatcher (`test/blocks/text/edge-policy-marker-completion.test.ts`); the
  bytes those keypresses leave are pinned at
  `test/blocks/blockquote/blockquote-leading-space.test.ts`
- A space at offset 0 of a quote child that is not empty is ordinary content: `> abc` becomes
  `>  abc`

## User interactions

- Every scenario types the opener as real keystrokes; the quote is never loaded through
  `setSource`, because the bug lives in the path that creates the quote, which a loaded
  document never runs

## Miss-analysis

- No scenario ever typed the opener `> ` as two keystrokes: every blockquote in the suite
  was loaded through `setSource`, so the space that completes the marker had no coverage at
  all, while editing a loaded quote was pinned throughout
- The repeated space was pinned as swallowed rather than asked whether it should be (GH
  #143): a test written from the answer the code gave rather than from what a user typing
  four spaces expects. The handler was a stateless check, so the suite could only assert the
  same answer twice; the general case is a handler whose rule depends on which keypress this
  is while its input never says
