# Feature: decoration fixtures: fold (replace) + block-badge (block)

Two fixture plugins that pin the remaining decoration types end-to-end on the
public API only. `fold` scans prose leaves for `[>…<]` delimiters and covers each
range with a clickable `…` replace widget (interactive DOM inside such a widget
works natively); `block-badge` puts a class and a badge widget on every heading
host. Scenarios run on `/test/plugins?seed=fold` / `?seed=fold-table` /
`?seed=badge`.

## Happy paths

- a delimited range renders as one `…` widget; the hidden bytes leave the DOM
  text but never leave `getSource()`
- clicking the `…` widget opens the fold: the widget unmounts and the full text
  (delimiters included) is visible again, source unchanged
- heading blocks carry the badge class and a badge widget as the host's first
  child; non-heading blocks carry neither

## User interactions

- typing in the block next to a folded range commits around the widget: the
  typed bytes land and the folded bytes survive in `getSource()`

## Edge cases

- a badge survives a block windowing out and back in on a multi-MB fixture
- widgets in cells: a fold range inside a table cell renders one `…` widget,
  because a cell's editable area applies widget decorations the way the prose
  path does. The covered bytes leave the DOM text but never leave `getSource()`,
  and the decoration source raises no cells-unsupported dev warning
- a destructive keypress at its edge selects the whole fold widget in the cell,
  and a second deletes the range it covers; the fold source is keyed on content,
  so it simply stops providing and the session raises no dev warning
