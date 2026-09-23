# Block: List, Task Checkbox (Enter in a to-do)

A completer that puts another kind of block in the item's first position takes the checkbox with
the paragraph it replaced. The new item's task marker is a byte rule pinned by
`src/lib/test/blocks/list/item-enter-dispatch.test.ts`.

## Regression guards

- Enter on a to-do holding a typed table row completes the table and drops the task marker: the
  bytes no longer say to-do, so the screen and the source agree.
  - Miss-analysis: the marker rule lived at the call sites that write content, and the completer
    replaces the block through a different write, so no test asked what the marker does on a route
    the rule was never copied to.
- Enter inside `- [ ] # adwada` leaves `- [ ] # ad` above `- [ ] wada`, and Enter before the `#`
  of `- [ ] ab# cd` leaves `- [ ] ab` above `- [ ] # cd`: each half is text beside its box, no
  heading, and the tree reloads as itself.
  - Miss-analysis: the task-aware reader reached typed writes and merges but not the list split,
    and the shape property keeps list-item bodies out of its split gesture, so no test split a
    to-do whose text would open a block on its own.
