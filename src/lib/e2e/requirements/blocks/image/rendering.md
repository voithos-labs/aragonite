# Feature: Image rendering

## Happy paths

- Standalone image line `![alt](url)\n` renders a widget element with `data-image-widget` attribute and an `<img>` child
- Mid-paragraph image `text ![alt](url) more` renders a widget element; the surrounding paragraph contains the widget plus surrounding text
- Image with `|400` renders the `<img>` with `width="400"`
- Image with `|400x300` renders `<img>` with `width="400"` and `height="300"`
- CDN-style URL `?w=400` renders the `<img>` with that `src` (resolver passthrough)

## Edge cases

- Image inside a table cell renders as alt-text-only DOM (no `data-image-widget` element in cell)
- Image inside a heading renders as a widget (heading is prose; default true)
- Empty alt `![](url)` renders the widget with empty alt attribute

## Error cases

- Image with broken URL (404 fixture) renders the widget with `md-image-broken` class after load fails
- Image that _succeeds_ with no intrinsic size (zero-dimension SVG) gets the same placeholder off the load alone — no edit, no mode flip, and the widget's box is non-degenerate
- Broken image preserves the block-level visual rule — its trailing text wraps below, same as a successfully-loaded image. The error styling overlays the widget without changing its display mode.
- Keystroke-rebuilt widget keeps `md-image-broken` at insertion time (no async re-add flicker)
