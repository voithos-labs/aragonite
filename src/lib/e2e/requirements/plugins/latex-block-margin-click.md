# Feature: a click beside a rendered equation focuses nothing

A `$$` block's rendered view is as wide as the block with the equation centred in it, so most of
the view is empty. A click in that emptiness, or in the editor's padding level with the block,
used to open the equation's source: the view took every click on its box, and the dead-space
caret clamped the padding point into the box and asked the kind for a landing, which named the
source end. Neither is a click on the equation.

## Happy paths

- A click in the view left or right of the equation's ink opens nothing and moves no caret.
- A click in the editor's padding level with the block opens nothing.
- A click on the equation opens its source, as before.
- An empty equation is all box, so a click anywhere in its box still opens it (there is no ink to
  aim at).

## Mechanism

- The render-primary leaf takes an optional `revealHitTest`; block math answers it from the
  horizontal extent of the text the renderer painted (engine-agnostic), with slack either side.
- The dead-space caret declines a block with no character surface unless the pressed point was
  on the block's own content, which also covers tables and rules (see
  `selection/dead-space-click.md`).

## Out of scope

- A drag that starts beside the equation still selects the block: the press is a whole-block
  anchor, and the drag, not the click, is the gesture.
