# Feature: generic directive container render + edit

An unregistered `:::name` directive has no first-class plugin kind, so it falls
back to the generic `directiveContainer` component: a dimmed read-only `:::name`
marker over a thin rail, with an editable nested body. Editing the body mutates
the container's children (never the document root) and round-trips byte-for-byte.

## Happy paths

- `:::foo` (no plugin registered for `foo`) renders as a `directiveContainer` block, not a raw fallback — a `:::foo` marker is shown and the body text `hello` sits in an editable nested block.

## User interactions

- Type into the body paragraph (real keyboard): the container's own raw rebuilds and the source round-trips the edit byte-for-byte; the edit stays inside the container's children, the document root stays a single block.
- Enter at the end of the body paragraph: a second body block is added inside the container (document root still one block), and the source stays self-consistent (round-trips).

## Error cases

- The `:::foo` marker is read-only chrome: it is `contenteditable="false"` and lives outside any editable region, so it cannot be caret-edited or typed into as text.
