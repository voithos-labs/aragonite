# Feature: Block decorations on a list item

A list item renders its own `.list-item-block` box instead of a block host, so a `block`
decoration addressed to an item's path lands on that box: the class and attributes on it, and a
badge as its first child.

## Happy paths

- A decoration on the second item of a two-item list puts its class and attributes on that
  item's box only, and its badge first inside it, non-editable
- Disposing the source removes the class, the attributes and the badge

## Edge cases

- A decoration on the list itself lands on the list's host and on none of its items
- An attribute the list's own styles read on the item (`data-task-checked`) is refused with a
  `decorations` warning, the task's own value stays, and the decoration's other attributes
  still land

## Miss-analysis

- Every block-decoration case addressed a top-level block, which always has a block host; no
  case addressed a node that renders its own box, so the item's missing host went unseen
