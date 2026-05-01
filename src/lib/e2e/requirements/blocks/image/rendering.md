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
