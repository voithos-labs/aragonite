# Block: List — Task Checkbox (live promotion via typing)

Typing a task-prefix at the start of a plain list item promotes it to a task item live; checkbox characters cannot be edited via keyboard.

## Edge cases

- Typing `[ ] ` (or `[x] ` / `[X] `) at the start of a plain list-item paragraph promotes the item to a task item live — the checkbox renders immediately, no reload required.
- The `[x]` characters inside the ambient region cannot be edited via keyboard (contenteditable="false" island).

## Regression guards

- listItem metadata reconciles live on inner-paragraph typing: promotion on gaining `[ ] ` / `[x] ` / `[X] ` prefix happens immediately; demotion on losing the prefix is a defensive path covered by unit tests on the reconcile helper.
