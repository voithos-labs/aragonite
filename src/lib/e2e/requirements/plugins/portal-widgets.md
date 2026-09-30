# Feature: Component-Portal Inline Widgets, Keyed Reuse Pool

A plugin inline widget kind renders through a Svelte `component` mounted inside the widget the
caret cannot enter. A keyed pool keeps one live instance per `(kind, source)` so a widget
survives the block rebuilding everything on every keystroke: typing next to an unchanged widget
takes over its instance rather than remounting it. Inline KaTeX is the kind being moved over, so
mount identity is read from `MathInline`'s `data-mount-id` on `.math-inline-widget`, which stays
the same when an instance is reused and is new after a remount.

Seed (`?seed=math`): `Before $x^2$ after` in block [0], `Next` in [1].
Seed (`?seed=mathtable`): a table whose one body cell holds `$x^2$`, with `After` below, for the
cell's render path.

## Happy paths

- load an inline `$x^2$` and type a character elsewhere in the same paragraph: the widget's
  `data-mount-id` is unchanged and the formula still renders, with KaTeX present, which is what
  the pool promises, no remount per keystroke
- a `$…$` in a table cell renders as a mounted widget, so the cell's render path is pooled too,
  and typing in the cell keeps its `data-mount-id` stable

## Edge cases

- show the widget's source, edit the formula, commit by walking the caret out: the widget
  renders with a new `data-mount-id`, because the source changed and it remounted, and shows the
  edited formula
- show the source, then press Escape: the rendered widget comes back, because canceling puts
  back the exact element it detached, KaTeX is present and the source is unchanged
- showing the source and pressing Escape over and over, with no render in between: the mount id
  stays the same through every cycle and through the next real render, so no second instance
  appears
- two byte-identical formulas in one paragraph, show the second one's source, press Escape: both
  widgets are present in place with their own mount ids and the source is byte-stable. This
  pins the regression where closing the source looked the instance up by key alone and moved the
  wrong one (miss-analysis: reuse was tested only against a single instance, and every scenario
  that showed a source seeded one widget, so duplicate keys were never crossed with it)

## User interactions

- real keyboard typing and a real mouse click, End and Escape, with no programmatic selection,
  caret placement or value setting

## Error cases

- the watcher for `[invariant:…]` messages and page errors stays silent across reuse, showing a
  source, committing an edit, canceling, and the table-cell path
