# Feature: Container Block Editing: Blockquote Unwrap on Backspace (Rule U2)

Backspace at offset 0 inside a blockquote inner paragraph lifts content out of the blockquote, one level per keypress.

## Blockquote unwrap on Backspace (Rule U2)

- Single-paragraph blockquote: Backspace at offset 0 of the first paragraph lifts it out; blockquote is deleted because it becomes empty
- Multi-paragraph blockquote: Backspace at offset 0 lifts only the first paragraph; remaining paragraphs stay inside the (shrunk) blockquote
- Nested blockquote: Backspace at start of innermost content unwraps one level (inner blockquote dissolves, content stays inside the outer blockquote). Multiple levels need multiple keypresses
- Blockquote preceded by paragraph: no auto-merge with the block above, since each Backspace performs exactly one structural operation
- Backspace at non-zero offset: normal character delete, U2 does not fire

## Cross-container interactions

- Blockquote containing a list: Backspace at start of the list's first item runs U1 (list unwrap) against the inner list, producing a plain paragraph still wrapped by `> `. See `blocks/list/rendering.md` for the full U1 semantics (first-item unwrap, matching-type sub-list promotion, mismatched sub-list as separate block, ordered renumbering).
