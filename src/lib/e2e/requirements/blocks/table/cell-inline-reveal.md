# Feature: inline-widget source reveal inside a table cell

The cell surface threads the same `createWidgetInteraction` + caret-edge dispatch
the prose block uses, so an inline math widget in a cell reveals its `$…$` source
for editing, commits on Enter/blur as one undo entry, and cancels on Escape.
Cell-specific: every reveal/edge commit re-escapes pipes like the keystroke path,
so a `|` typed into a revealed formula can never split the row on reparse.
Scenarios run on `/test/plugins?seed=mathtable`
(`| Formula | Note |\n| --- | --- |\n| $x^2$ | ok |\n\nAfter\n`).

## Happy paths

- clicking the rendered math in a cell reveals its `$…$` source without touching
  the CST (the widget vanishes, the raw becomes editable text)
- editing the revealed source and pressing Enter re-renders KaTeX and persists the
  edit; the table stays a two-column row and the source round-trips
- caret-edge entry into the math (Backspace at the cell's trailing edge) reveals the
  source in place rather than deleting the widget

## User interactions

- typing a `|` into a revealed formula and committing escapes it to `\|`, so the
  row keeps its column count; `getSource()` round-trips byte-for-byte
- focus leaving the cell with source revealed commits the edit as one undo entry —
  a single Ctrl+Z reverts the whole reveal edit
- Escape discards the source edit and restores the rendered widget, source unchanged
