# Block: List, Task Checkbox (live promotion via typing)

Typing a task prefix at the start of a plain list item turns it into a task item as you type; the checkbox characters cannot be edited from the keyboard.

## Edge cases

- Typing `[ ] ` (or `[x] ` / `[X] `) at the start of a plain list-item paragraph turns the item into a task item there and then: the checkbox renders immediately, with no reload required.
- The `[x]` characters inside the marker region cannot be edited from the keyboard (they sit in a contenteditable="false" widget).

## Regression guards

- listItem metadata is re-derived as the inner paragraph is typed into: gaining a `[ ] ` / `[x] ` / `[X] ` prefix promotes the item immediately; losing the prefix demotes it, which is a defensive path covered by unit tests on the helper.
