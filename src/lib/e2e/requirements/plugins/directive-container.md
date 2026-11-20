# Feature: generic directive container render + edit

A `:::name` directive no plugin has registered has no kind of its own, so it falls back to the
generic `directiveContainer` component: its opener line as an editable first row (the `:::name`
dimmed) over a thin side gutter, with an editable nested body. Editing the body changes the
container's children, never the document root, and round-trips byte for byte.

## Happy paths

- `:::foo` (no plugin registered for `foo`) renders as a `directiveContainer` block rather than falling back to raw text: its children are the opener line `:::foo` and the body text `hello`, each in an editable block.

## User interactions

- Type into the body paragraph (real keyboard): the container rebuilds its own raw text and the source round-trips the edit byte for byte; the edit stays inside the container's children and the document root stays a single block.
- Enter at the end of the body paragraph: a second body block is added inside the container, the document root still holds one block, and the source stays self-consistent (it round-trips).
- Type a title at the end of the opener line: it lands on the line (`:::foo Title`), the container keeps its kind, and the source round-trips.

## Regressions

- A letter typed in the colons of `::::foo Hi` holding a nested `:::tip` container, in live and source mode: the line takes the colons as typed (`::xw::foo Hi`) and the tree is the one a reload reads. The rebuild grew the opener back to the four colons the nested body asks for, over the colons typed, and Backspace there wrote nothing. Miss-analysis: every opener-line row edited a three-colon fence, whose body asks no growth.

- Letters typed at the start of the `:::foo` line, the container holding two blocks and standing flush under a paragraph: they land where they were typed and the tree is the one a reload reads. The container's first lines were written twice, with no plugin involved. Miss-analysis: the generic container's rows typed in its body or its title, never in its `:::name`, and never with a block flush above it.
