# Feature: a selected inline widget takes its own key

The `inline-key` harness plugin draws `{{label}}` as an `inline()` widget an arrow selects whole.
Its `key` takes ArrowUp while the widget is selected and writes the label in capitals through
`props.editor`, at the widget's document bytes. Seed `inline-key`: block 0 `Before`, block 1
`an {{chip}} here`, in live mode.

## Happy paths

- An arrow into the widget selects it whole; ArrowUp then writes `{{CHIP}}`, and the caret stays in
  its block.

## Edge cases

- A key the widget declines goes on to the editor: ArrowRight steps past it, and a letter typed
  next lands after it.

Miss-analysis: the unit row called the widget's key handler directly, so nothing pressed a key on
a widget the editor had selected, the one place the editor asks it.
