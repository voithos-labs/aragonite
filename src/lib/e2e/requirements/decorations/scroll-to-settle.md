# Feature: scrollTo lands and holds its target past undecoded images

`rects.scrollTo(path, opts?)` reveals (mounts) a windowed-out block and scrolls
the viewport to it. On a document with unsized, still-decoding images above the
target, those images reserve height while off-window and collapse to ~0 once they
mount — the document shrinks under the reveal scroll and, without a reveal-target
anchor, the browser clamps the viewport off the target and strands it. `scrollTo`
sets the reveal anchor (per its requested `block` placement) so the target is
re-asserted on every post-mount measure pass, and resolves its boolean only after
the position settles — so `true` means genuinely in view at the resolved position.

## Happy paths

- `scrollTo` to the document's last block, past a band of undecoded images, lands
  it mounted and in view (not clamped off-screen), and resolves `true`.
- `scrollTo(path, { block: 'center' })` to a mid-document heading below a dense
  band of undecoded images keeps the target centered in the viewport (within the
  center tolerance) after the post-mount shrink, and resolves `true`.

## Edge cases

- The boolean is honest under async-height churn: a resolved `true` correlates
  with the target being in view; a target that never resolves resolves `false`.

## User interactions

- The reveal-target anchor holds only through the settle: a target revealed past
  undecoded images stays in view without a follow-up gesture.
