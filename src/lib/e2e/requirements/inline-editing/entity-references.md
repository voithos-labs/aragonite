# Feature: Entity & Numeric Character References (CommonMark §6.2)

Recognition and composition of character references across their forms and contexts.
A visible-glyph reference renders as an atomic glyph widget; its atomic caret / delete
behavior is the separate concern of `entity-widget.md`.

## Happy paths

- Type `&copy;`: renders as an atomic `[data-inline-widget]` showing the decoded glyph `©`; `getSource()` returns `&copy;` verbatim.
- Type `&amp;`: same; decoded glyph `&`.
- Type `&#39;` (decimal): recognized; renders the glyph `'`.
- Type `&#x22;` (hex lowercase): recognized; renders the glyph `"`.
- Type `&#X22;` (hex uppercase): recognized identically.

## Edge cases

- Type partial `&am`: renders as plain text; the moment the user completes `&amp;`, the entity is recognized on the next input event.
- Type `&notreal;`: stays as plain text; no entity node forms.
- Type `&;`, `&amp` (no semicolon), `&#abc;`, `&#xZZ;`: all stay as plain text.
- Type `&#0;`: entity node forms with `decoded === '�'` (replacement character).
- Type `&#x110000;` (above Unicode max): entity node forms with `decoded === '�'`.

## User interactions

- Type `&` then continue typing: the entity scanner does not commit until the closing `;` arrives, so no glyph widget appears until the reference is complete.
- Atomic caret behavior (step-over, one-press whole-delete, undo) is specified and pinned in `entity-widget.md` — a visible entity is an atomic island, not character-by-character-editable source.

## Composition with other inline syntax

- `*&copy;*`: emphasis forms; the entity is a child of the emphasis node and its glyph widget renders inside the `<em>`.
- `[&copy; me](https://example.com)`: the entity is a child of the link text and its glyph widget renders inside the anchor.
- `` `&copy;` ``: the entity is inert inside the code span; the source renders as literal `&copy;` text in monospace (no widget).

## Round-trip

- `getSource()` after typing entities returns the source bytes verbatim — entities are never serialized to their decoded form.

## Coverage notes

The following scenarios are exercised at the unit-test level (`src/lib/test/core/inline/character-refs.test.ts`) rather than via E2E:

- Malformed forms (`&;`, `&amp` without semicolon, `&#abc;`, `&#xZZ;`) emitted as plain text.
- Boundary numeric references (`&#0;`, `&#x110000;`, surrogate-range code points) decoded to U+FFFD per CommonMark §6.2 — a U+FFFD glyph is visible, so it renders as a widget.
- The visibility gate (`&nbsp;` and other whitespace/control decodings keep the literal span) is unit-pinned in `src/lib/test/core/inline/entity-widget.test.ts`.
