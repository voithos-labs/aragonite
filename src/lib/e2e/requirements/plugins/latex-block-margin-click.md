# Feature: a click beside a rendered equation focuses nothing

A `$$` block's card is the block: a click anywhere in the card opens the equation's source,
whether it lands on the equation itself or on the card's own padding around it. The editor's
padding level with the block is not the block. It used to open the source too, because the
handler for clicks in empty space clamped the padding point into the box and asked the kind
where to land, which answered with the end of the source; that is a click on nothing.

## Happy paths

- A click in the card, left or right of the equation itself, opens the source, as a click on the
  equation does.
- A click in the editor's padding level with the block opens nothing and moves no caret.
- A click on the equation opens its source, as before.

## Mechanism

- The handler for clicks in empty space declines a block with no text to measure unless the
  point clicked was on the block's own content, which also covers tables and rules (see
  `selection/dead-space-click.md`).

## Out of scope

- A drag that starts in the card selects the block: the click anchors a whole-block selection,
  and the gesture there is the drag, not the click.
