# Block: List — Task Checkbox (Enter in a to-do)

New items inherit task-ness from the source item, and a completer that puts another kind of block
in the item's first position takes the checkbox with the paragraph it replaced.

## Regression guards

- Enter at end of a task list item creates a new unchecked task item (inherits task-ness from source); plain list items stay plain.
- Enter on a to-do holding a typed table row completes the table and drops the task marker: the
  bytes no longer say to-do, so the screen and the source agree.
  - Miss-analysis: the marker rule was carried at the content-write call sites, and the completer
    replaces the block through a different write, so no test asked what the marker does on a route
    the rule was never copied to.
