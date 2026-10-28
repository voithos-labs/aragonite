# Feature: a block drawn whole by the app's framework

The `?block-views` page (`block-views.md`) ends with a `!! d6` die: a block the app's component
draws entirely (`reactBlockView` or `vueBlockView` on the `'none'` surface), with no editable text
and no children. It's one button that rolls the die in order (1, 2, 3, ...), and the component
hands the editor what it calls on the block through `useBlockHandle`: `focus` puts focus on the
button, `getCursorOffset` says whether the button has it, and `focusable` is true. The die sits
between `after the blocks` and `the end`. Every scenario fails on any console error, page error or
console warning.

## Happy paths

- ArrowDown from `after the blocks` puts focus on the die's button, and a second ArrowDown leaves
  for `the end`. ArrowUp walks back the same way, and the document is unchanged.
- Enter and Space at the focused die roll it (`d6: 1`, then `d6: 2`), keep focus on the button and
  leave the document unchanged.
- A roll, a click into `the end` and an ArrowUp back put focus on the die again, still showing the
  roll.

## Edge cases

- Ctrl+Z pressed at the focused die undoes the typing just before it in `the end`.
- In the long document, the die scrolled out of the window and back is mounted again, and arrows
  go in and out of it as before.

## Error cases

- A line typed into `!! boom`, whose component throws, shows its source in place of the die and
  reports to the editor's `error` event, with nothing on the console; the die above still draws.
