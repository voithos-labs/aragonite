# Block: List, Task Checkbox (accessibility)

ARIA attributes on the checkbox span, the state changing in the same tick as the toggle, and the
keyboard path to the toggle.

## Accessibility

- The checkbox span carries `role="checkbox"` and `aria-checked` reflecting current state.
- `aria-checked` changes in the same tick as the toggle.

## Keyboard

- With the caret in a task item, Mod+Enter toggles the box: the bytes flip `[ ]` to `[x]` and back, and `aria-checked` follows.
- The box is never a tab stop: it carries no `tabindex`, and Tab from the item does not focus it.
- In a plain list item Mod+Enter declines and the bytes are unchanged.

## Miss-analysis

- The accessibility spec covered the attributes and the click, and no case ever reached the box without a mouse, so a keyboard user's missing path had no test to fail.
