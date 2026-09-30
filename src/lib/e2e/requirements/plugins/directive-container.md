# Feature: generic directive container render + edit

A `:::name` directive no plugin has registered has no kind of its own, so it falls back to the
generic `directiveContainer` component: a dimmed, read-only `:::name` marker over a thin side
gutter, with an editable nested body. Editing the body changes the container's children, never
the document root, and round-trips byte for byte.

## Happy paths

- `:::foo` (no plugin registered for `foo`) renders as a `directiveContainer` block rather than falling back to raw text: a `:::foo` marker is shown and the body text `hello` sits in an editable nested block.

## User interactions

- Type into the body paragraph (real keyboard): the container rebuilds its own raw text and the source round-trips the edit byte for byte; the edit stays inside the container's children and the document root stays a single block.
- Enter at the end of the body paragraph: a second body block is added inside the container, the document root still holds one block, and the source stays self-consistent (it round-trips).

## Error cases

- The `:::foo` marker is read-only: it is `contenteditable="false"` and sits outside any editable region, so it cannot take a caret or be typed into as text.
