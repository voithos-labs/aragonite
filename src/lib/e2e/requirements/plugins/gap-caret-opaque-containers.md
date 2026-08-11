# Feature: gap caret between opaque containers

Opaque-contract containers (the admonition callouts, details, the generic `:::` directive
container) are the tier with no textual escape hatch: two adjacent callouts leave no
position to type a paragraph between them. The tier rule (#93): every opaque-contract kind
declares `gapEdges: 'both'`; strip containers (blockquote, list, listItem, githubAlert)
stay undeclared because their unwrap/exit gestures already cover insertion. Eligibility
stays a descriptor read; no selection code names a kind.

Arrival/mint/undo mechanics are pinned generically in `selection/gap-caret-*.md`; this
file pins the opaque-container boundaries those specs cannot reach, plus the strip
negative that is the decision's other half.

## Happy paths

- ArrowDown out of a callout's last body child, with a second callout below: the caret
  parks at their root boundary; typing mints a paragraph between the two callouts,
  byte-exactly, and the document still round-trips.
- One undo drops the minted paragraph, restores the source byte-for-byte, and parks the
  caret back on the boundary.
- ArrowUp from the second callout's title parks at the same boundary; a second ArrowUp
  enters the callout above.
- ArrowDown out of an open details' body, with a callout below: the mixed
  details|callout boundary parks and mints the same way.
- A click in the editor's leading padding above a document that starts with a callout
  parks at the document's start boundary.

## Edge cases

- A COLLAPSED details above a callout: ArrowDown from the summary must not dead-end on
  the clamped-out body — it parks at the details|callout boundary.
- blockquote|blockquote stays gap-free: ArrowDown out of the first quote enters the
  second as it always did (the strip tier stays undeclared by decision, not omission).

## User interactions

- Every arrival is an arrow key or a mouse click; the mint is real typing; undo is the
  keyboard chord.

## Miss analysis

No test could have caught the missing declarations: eligibility is declared, never
inferred, so an undeclared tier is indistinguishable from a decided decline, and only the
owner decision in #93 turned it into a defect. The strip negative exists so the next tier
widening has to be a decision too.
