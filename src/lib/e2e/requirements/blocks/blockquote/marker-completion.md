# Feature: Blockquote marker completion (the space that finishes `> `)

The blockquote opener fires on a bare `>`, so typing it in an empty paragraph mints the
quote immediately and the caret lands in its empty child. The space a user types next is
part of the marker they are still writing, not content: it is consumed, no byte moves and
no undo entry is pushed. `rebuildBlockquoteRaw` canonicalizes `> ` on content lines, so
the space materializes on its own the moment content arrives — the list twin already
behaves this way, where `-` alone stays a paragraph and the flip mints `- ` whole.

Mode-independent: blockquote chrome is a border in every presentation mode, so live and
source share both the defect and the fix.

## Happy paths

- Live mode, typing `>` then space then `a` in an empty paragraph yields `> a` — one
  space, not two — and the space press alone leaves the source byte-identical
- Source mode runs the same three keystrokes to the same `> a`
- Typing `>`, space, `>`, space, `a` nests: the inner quote completes at its own depth and
  yields `> > a`

## Edge cases

- Any empty child completes the same way wherever it sits (first, middle or last, made by
  an Enter or loaded with the document): the space is consumed there too, so the following
  character lands as `> x` rather than `>  x`
- Only the FIRST press at a given empty child completes the marker. A consumed press writes
  nothing, so the child looks identical to press 2 and only the dispatch's own memory tells
  them apart; press 2 lands as ordinary content, which is what makes leading whitespace and
  the indented-code opener typeable in keystroke order. "Given child" is the CST node, so a
  child a commit re-minted (typing content and deleting it back to empty) answers its next
  space as a completion again — a bare `>` line always reads the same way. The middle seat and
  the second-press decline pin at the dispatch
  (`test/blocks/text/edge-policy-marker-completion.test.ts`); the bytes those presses leave pin
  at `test/blocks/blockquote/blockquote-leading-space.test.ts`
- A space at offset 0 of a NON-empty quote child is ordinary content: `> abc` becomes
  `>  abc`

## User interactions

- Every scenario types the opener as real keystrokes; the quote is never loaded through
  `setSource`, because the defect lives in the mint path a loaded document never runs

## Miss-analysis

- No scenario ever typed the opener sequence `> ` as two keystrokes — every blockquote in
  the suite was loaded via `setSource`, so the marker-completion press had zero coverage
  while the loaded quote's editing was pinned throughout
- The repeat case was pinned as consumed rather than asked whether it should be (GH #143):
  a test written from the implementation's answer rather than from what a user typing four
  spaces expects. The dispatch arm was a stateless predicate, so the suite could only assert
  the same answer twice; the class is an arm whose contract needs a press ORDINAL and whose
  input carries none
