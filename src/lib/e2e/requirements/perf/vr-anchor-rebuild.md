# Feature: Virtual rendering — measured heights survive a structural rebuild

List items and table rows aren't `BlockHost`s, so their measured box reaches the parent model
only through the child-subtotal channel. That channel must persist the box to the oracle by id,
or a count-changing edit reseeds every surviving sibling from estimate and the viewport jumps.
Both fixtures are non-uniform on purpose: where estimate already equals measured, the reseed is
a no-op and the defect is unreachable.

## Happy paths

- List-rebuild height persistence: in a windowed non-uniform list, scrolling so off-window items measure in and then making a structural edit that changes the item count (Enter at an item end → +1 item) does not collapse the content height or teleport the viewport. Asserted on `.editor` scrollHeight stability and the top in-view nested host's offset.
- Table-rebuild height persistence: in a windowed non-uniform table, scrolling so off-window rows measure in and then a structural edit that changes the row count (Ctrl+Enter inserts a row) does not collapse the content height or teleport the viewport. Asserted on `.editor` scrollHeight stability and the reference row (above the edit) not teleporting.

## Edge cases

- Non-vacuity preconditions carried by both scenarios: the scroll is progressive rather than a direct jump (items and rows reach the model only while mounted, so measuring them in first is what makes the reseed observable), and the rebuild is confirmed by polling the CST child count, never the DOM's — windowing mounts only a slice.
- The edited sibling sits LOWER in the viewport than the reference, so the insertion lands below it and the reference's path stays valid across the edit.

## Error cases

- No page errors surface during either structural edit.
