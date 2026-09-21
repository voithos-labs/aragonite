# Feature: Search reveal stays on target past undecoded images

Navigating search to an off-window match that sits below a band of unsized,
still-decoding images must bring the match into the viewport and hold it
there. The images reserve no height until they decode, so the document shrinks
under the scroll; unless the target block is held in place, the browser clamps
the viewport up onto a higher block and strands the match off-screen.

## Happy paths

- Typing a unique query whose only match is the document's last block, past a
  band of undecoded unsized images, scrolls that block into view and leaves it
  mounted there.

## User interactions

- Clicking the Previous-match button to scroll to the same single match again keeps it
  mounted and in view: the gesture that releases the held block (its pointerdown) also
  holds it again (the scroll that follows), so the block survives the click.
