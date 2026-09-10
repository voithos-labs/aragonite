# Feature: a click beside a rendered equation focuses nothing

A `$$` block's card is the block: a click anywhere in the card opens the equation's source,
whether it lands on the ink or on the card's own padding around it. The editor's padding level
with the block is not the block. It used to open the source too, because the dead-space caret
clamped the padding point into the box and asked the kind for a landing, which named the source
end; that is a click on nothing.

## Happy paths

- A click in the card left or right of the equation's ink opens the source, as a click on the
  ink does.
- A click in the editor's padding level with the block opens nothing and moves no caret.
- A click on the equation opens its source, as before.

## Mechanism

- The dead-space caret declines a block with no character surface unless the pressed point was
  on the block's own content, which also covers tables and rules (see
  `selection/dead-space-click.md`).

## Out of scope

- A drag that starts in the card selects the block: the press is a whole-block anchor, and the
  drag, not the click, is the gesture.
