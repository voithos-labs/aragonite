# Feature: fenced-code fence lines across presentation modes

The code renderer wraps each fence line (opener, closer) in a `.md-fence-line`
element so presentation modes collapse the whole line — the marker span AND its
line's `\n` — with `display: none`. Without the wrapper the marker spans hide but
their bare `\n` text nodes stay in flow, painting a blank line at the code box's
top and bottom. Bytes are hidden, never omitted: the fence text stays in the
block's textContent (the coordinate-space contract). Driven on `/test/editor` via
the header presentation toggles (real clicks); heights are read from the rendered
`.code-block` box.

## Happy paths

- reading mode collapses the two fence lines: the code box shrinks by ≈ 2
  line-heights versus source (opener + closer gone), leaving no blank line at the
  box's top or bottom
- both `.md-fence-line` wrappers compute `display: none` in reading mode
- preview-block: an unfocused code block hides its fence lines; focusing it
  reveals them and the box grows back
- preview-inline: code fences are whole-block markers, so focusing reveals them
  exactly as preview-block (and the box grows)

## Edge cases

- the fence DOM is hidden, never omitted: the fence text (` ```js `, body) stays
  in the block's textContent while the wrapper is collapsed
- blurring the code block (focusing another block) hides the fence lines again and
  the box shrinks back

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
