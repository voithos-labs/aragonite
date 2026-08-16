# Feature: Virtual rendering — resize invalidation (VR-1)

A resize invalidates on two independent axes, and the editor treats them separately. WIDTH
re-wraps prose, so cached heights computed at the old width are stale: the measured cache is
cleared, the model rebuilds at the new width, and mounted blocks re-measure. HEIGHT re-wraps
nothing and spares that cache, but the window's extent is derived from the scrollport's height,
so the slice must recompute.

## Happy paths

- Narrowing the viewport re-measures wrapped heights and holds the anchor: on a windowed doc of long paragraphs that re-wrap with width, scrolling to mount and measure a band at the wide width then narrowing clears the measured cache, rebuilds every scope's model, and re-measures the mounted blocks. The model-backed `scrollHeight` grows to track the narrower wrap, and the top-of-viewport block does not teleport. Reverting the width wiring leaves the model on stale wide heights: `scrollHeight` does not track and the anchor teleports.
- Growing the viewport height alone extends the mounted band into the newly exposed area: same width, so nothing re-wraps and the measured cache survives, but the slice recomputes and the mounted boxes reach both edges of the taller scrollport within a flush. Reverting the viewport-height signal leaves the mounted set byte-identical and the bottom of the taller viewport bare spacer until any scroll or keystroke.

## Edge cases

- The anchor is measured relative to the EDITOR, not the browser viewport: a resize reflows the harness chrome above the editor slot, a shift the anchor correction does not own.
- The height path newly runs an anchor correction where none ran before, so the reader must not be thrown while the band fills.

## Error cases

- No page errors surface on either resize axis.
