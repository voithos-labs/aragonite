# Feature: scrollTo lands and holds its target past undecoded images

`rects.scrollTo(path, opts?)` mounts a block windowing left out and scrolls the
viewport to it. On a document with unsized, still-decoding images above the
target, those images reserve height while unmounted and collapse to about zero
once they mount: the document shrinks under the scroll, and with nothing holding
the target in place the browser clamps the viewport off it and strands it.
`scrollTo` holds the target itself in place, at the `block` placement it was asked
for, so the target is re-asserted on every measure pass after the mount, and
resolves its boolean only once the position stops moving. A `true` therefore means
genuinely in view at the requested position.

## Happy paths

- `scrollTo` to the document's last block, past a band of undecoded images, lands
  it mounted and in view (not clamped off-screen), and resolves `true`.
- `scrollTo(path, { block: 'center' })` to a mid-document heading below a dense
  band of undecoded images keeps the target centered in the viewport (within the
  center tolerance) after the shrink that follows the mount, and resolves `true`.

## Edge cases

- The boolean is honest while heights are still changing: a resolved `true` goes
  with the target being in view, and a target that never gets there resolves `false`.

## User interactions

- The target is held in place only until the position stops moving: a target
  scrolled to past undecoded images stays in view without a follow-up gesture.
