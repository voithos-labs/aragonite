# Feature: Component-Portal Inline Widgets — Keyed Reuse Pool

A plugin inline widget kind renders through a Svelte `component` mounted in the
atomic island. A keyed reuse pool keeps one live instance per `(kind, source)` so a
widget survives the block's rebuild-everything-per-keystroke render: typing next to
an unchanged widget adopts its instance rather than remounting it. KaTeX inline is
the migrating validator, so the mount-identity oracle is `MathInline`'s
`data-mount-id` on `.math-inline-widget` — stable across adoption, new on a remount.

Seed (`?seed=math`): `Before $x^2$ after` in block [0], `Next` in [1].
Seed (`?seed=mathtable`): a table whose one body cell holds `$x^2$`, `After` below —
for the cell render surface.

## Happy paths

- load an inline `$x^2$`, type a character elsewhere in the same paragraph: the
  widget's `data-mount-id` is unchanged and the formula still renders (KaTeX present)
  — the seam guarantee, no per-keystroke remount
- a `$…$` in a table cell renders as a mounted widget (the cell render surface is
  pooled), and typing in the cell keeps its `data-mount-id` stable

## Edge cases

- reveal the widget, edit the formula, commit (walk the caret out): the widget renders a NEW
  `data-mount-id` (source changed → remount) and shows the edited formula
- reveal the widget, press Escape: the rendered widget returns (the cancel swap
  re-inserts the exact element it detached), KaTeX present, source unchanged
- repeated reveal → Escape cycles with no render between: the mount id stays stable
  through every cycle and through the next real render — no duplicate instance
- two byte-identical formulas in one paragraph, reveal the SECOND, Escape: BOTH
  widgets present in place with their own mount-ids and byte-stable source.
  Regression pin for the key-only fold-back lookup that moved the wrong instance
  (miss-analysis: reuse was tested only against a single instance, and every reveal
  scenario seeded a single widget — duplicate keys were never crossed with reveal)

## User interactions

- real keyboard typing and real mouse click / End / Escape — no programmatic
  selection, caret placement, or value setting

## Error cases

- the `[invariant:…]` / pageerror console watcher stays silent across adoption,
  reveal, edit-commit, cancel, and the table-cell path
