# Feature: Entity & Numeric Character References (CommonMark §6.2)

## Happy paths
- Type `&copy;`: renders as a styled `md-entity` span containing the literal source bytes; `getSource()` returns `&copy;` verbatim.
- Type `&amp;`: same as above; decoded value is `&` (carried on the inline node, not shown in the editor surface).
- Type `&#39;` (decimal): recognized as an entity reference; decoded value is `'`.
- Type `&#x22;` (hex lowercase): recognized; decoded value is `"`.
- Type `&#X22;` (hex uppercase): recognized identically.

## Edge cases
- Type partial `&am`: renders as plain text; the moment the user completes `&amp;`, the entity is recognized on the next input event.
- Type `&notreal;`: stays as plain text; no entity node forms.
- Type `&;`, `&amp` (no semicolon), `&#abc;`, `&#xZZ;`: all stay as plain text.
- Type `&#0;`: entity node forms with `decoded === '�'` (replacement character).
- Type `&#x110000;` (above Unicode max): entity node forms with `decoded === '�'`.

## User interactions
- Place cursor inside `&copy;`: arrow keys move character-by-character through the source bytes; `Backspace` deletes one character at a time and breaks the entity into plain text on the next input.
- Backspace the `;` of `&copy;`: entity collapses to plain text `&copy`.
- Type `&` then continue typing: entity scanner does not commit until the closing `;` arrives.

## Composition with other inline syntax
- `*&copy;*`: emphasis forms; the entity is a child of the emphasis node and renders both styles compounded.
- `[&copy; me](https://example.com)`: entity is a child of the link text and renders inside the anchor styling.
- `` `&copy;` ``: entity is inert inside the code span; renders as literal `&copy;` text in monospace.

## Round-trip
- `getSource()` after typing entities returns the source bytes verbatim — entities are never serialized to their decoded form.
