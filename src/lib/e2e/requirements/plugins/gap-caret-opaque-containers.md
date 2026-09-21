# Feature: gap caret between opaque containers

Opaque containers (the admonition callouts, details, the generic `:::` directive container) are
the group with no way out through typing: two callouts side by side leave nowhere to type a
paragraph between them. The rule for that group (#93): every opaque kind declares
`gapEdges: 'both'`, while the containers whose marker is stripped (blockquote, list, listItem,
githubAlert) declare nothing, because their own unwrap and exit gestures already let you insert
a block. Whether a boundary qualifies is read from the descriptor, and no selection code names a
kind.

How the caret arrives, how the new paragraph is created and how undo behaves are pinned for all
kinds in `selection/gap-caret-*.md`. This file pins the boundaries between opaque containers
that those specs cannot reach, plus the case that must not work for a stripped container, which
is the other half of the decision.

## Happy paths

- ArrowDown out of a callout's last body child, with a second callout below: the caret rests at
  their boundary in the root list; typing creates a paragraph between the two callouts, byte for
  byte, and the document still round-trips.
- One undo removes the new paragraph, restores the source byte for byte, and puts the caret back
  on the boundary.
- ArrowUp from the second callout's title rests at the same boundary; a second ArrowUp enters
  the callout above.
- ArrowDown out of an open details' body, with a callout below: the boundary between the details
  and the callout rests and creates the same way.
- A click in the editor's leading padding, above a document that starts with a callout, rests at
  the boundary at the document's start.

## Edge cases

- A collapsed details above a callout: ArrowDown from the summary must not stop dead on the
  clamped-out body; it rests at the boundary between the details and the callout.
- Two blockquotes have no gap: ArrowDown out of the first quote enters the second as it always
  did, because the stripped containers are left undeclared by decision, not by oversight.

## User interactions

- Every arrival is an arrow key or a mouse click; the new paragraph comes from real typing; undo
  is the keyboard chord.

## Miss analysis

No test could have caught the missing declarations: a kind declares whether it qualifies and
nothing infers it, so a group that declares nothing looks exactly like a group that decided
against it, and only the owner's decision in #93 made it a defect. The case that must not work
for a stripped container is there so that the next widening of the group has to be a decision
too.
