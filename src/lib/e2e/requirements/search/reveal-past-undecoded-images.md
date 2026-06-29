# Feature: Search reveal stays on target past undecoded images

Navigating search to an off-window match that sits below a band of unsized,
still-decoding images must land — and hold — the match in the viewport. The
images reserve no height until they decode, so the document shrinks under the
reveal scroll; without a reveal-target anchor the browser clamps the viewport
up onto a higher block and strands the match off-screen.

## Happy paths

- Typing a unique query whose only match is the document's last block, past a
  band of undecoded unsized images, reveals that block mounted and in view.

## User interactions

- Clicking the Previous-match button to re-reveal the same single match keeps it
  mounted and in view — the gesture that clears the anchor (its pointerdown) also
  re-sets it (the resulting reveal), so the anchor survives the click.
