# Feature: Block decorations on a list item

A list item renders its own `.list-item-block` box instead of a block host, so a `block`
decoration addressed to an item's path lands on that box: the class and attributes on it, and a
badge as its first child. The badge stacks above the item's marker and text, as a host's badge
stacks above its block, so neither moves when it mounts.

## Happy paths

- A decoration on the second item of a two-item list puts its class and attributes on that
  item's box only, and its badge first inside it, non-editable
- Disposing the source removes the class, the attributes and the badge
- A badge on an item sits above its marker and text: the marker's left edge, the content's
  left edge and the content's width are the same with the badge as without it

## Edge cases

- A decoration on the list itself lands on the list's host and on none of its items
- An attribute the list's own styles read on the item (`data-task-checked`) is refused with a
  `decorations` warning, the task's own value stays, and the decoration's other attributes
  still land

## Miss-analysis

- Every block-decoration case addressed a top-level block, which always has a block host; no
  case addressed a node that renders its own box, so the item's missing host went unseen
- A badge on an item pushed its marker and text right by the badge's width: the item case
  checked the badge was the box's first child and never measured where the content landed
