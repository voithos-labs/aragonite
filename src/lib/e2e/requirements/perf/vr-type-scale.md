# Feature: windowing under a host type scale (`--editor-font-size`)

The height estimator guesses a block's height before it has ever mounted, and those
guesses decide two things: the spacer geometry, and, through the activation
threshold, whether the document windows at all. Both estimates are calibrated at
the editor's default type scale.

`--editor-font-size` scales that type scale linearly (the editor's `line-height`
is unitless), so a host that doubles it doubles every line box and halves the
characters that fit on one. The two compound: a wrapped paragraph estimated at the
default scale can be off several-fold. That is not a rounding error: an estimated
total that falls short of the threshold means the document does not window, and
every block mounts at load, which is the spike windowing exists to prevent.

So the estimates read the root's live computed font size. A host may drive the
token from a zoom control, so the scale is re-read whenever it changes, not
sampled once at mount.

## Happy paths

- A document sized just under the threshold at the default scale renders every block with no spacers: it is genuinely a small document there, and an estimator that knows the scale must not window it anyway.
- The same document with `--editor-font-size: 2rem` set on `.editor` windows: spacers render and the mounted set is a fraction of the block count. Its true height clears the threshold at that scale, and an estimator calibrated only for the default would miss it and mount the whole document.

## User interactions

- Changing the token while a windowed document is open re-estimates the off-window set: the scrollable height grows with the scale rather than only by the re-measure of the mounted window. Mounted blocks heal themselves through their own resize path; the blocks that have never mounted only heal if the estimate itself knows the scale.

## Edge cases

- Only genuinely font-relative terms scale: the per-line heights and the average character width. A block's own padding is absolute and an image's rendered height is its own, so neither tracks the token.
