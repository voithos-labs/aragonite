# Feature: Backslash Escapes (CommonMark §6.1)

## Happy paths

- Type `\*foo\*`: emphasis does NOT form; both `\` characters render dimmed (`md-marker`); `*` characters render as plain text inside the contenteditable; `getSource()` returns `\*foo\*`.
- Type `\**foo\**`: strong does NOT form; both `**` sequences are escaped via the leading `\`.
- Type `\` followed by every escapable punctuation char `!"#$%&'()*+,-./:;<=>?@[\]^_\`{|}~`: each produces a styled escape (markers visible, escaped char visible) and round-trips intact.

## Edge cases

- Type `\\*`: the first `\` escapes the second `\`, leaving `*` as a normal delimiter. If followed by `foo\\*`, emphasis forms across `\\*foo\\*` (because each pair `\\` is a single escape and the `*` chars are unescaped delimiters).
- Type `\a`, `\1`, `\<space>`: `\` is rendered as a literal backslash (text node, no marker styling); the following character is plain text.
- Type a trailing `\` at end of paragraph: renders as plain backslash text.
- Type `\` followed by Enter (newline): triggers hard line break; existing behavior unchanged.

## User interactions

- Place cursor between `\` and the escaped character: cursor lands at offset 1 of the escape node; ArrowRight advances to after the escaped character (offset 2).
- Backspace the `\` from `\*foo*`: emphasis re-forms on the next input event.
- Prepend `\` to an existing `*foo*`: emphasis collapses on the next input event; the `*foo` becomes plain text with an escape on the leading `*`.

## Inertness

- Escape inside an inline code span (`` `\*` ``): no escape node forms; the `\*` sequence renders as raw text inside the code span.
- Escape inside a paragraph that is also inside a list item: behaves identically to the top-level paragraph case (container nesting does not change inline parsing).

## Round-trip

- `getSource()` after typing escapes returns exactly what the user typed; no normalization, no decoding.

## Coverage notes

The following scenarios are exercised at the unit-test level (`src/lib/editor/test/core/inline/escapes.test.ts`) rather than via E2E, since they're parser-internal contracts not visible as user-facing DOM behavior:

- The full 32-character escapable punctuation set (parameterized table).
- Cursor offset semantics between `\` and the escaped character (covered indirectly via `findNodeAtOffset` tests in `cursor-mapping.test.ts`).
- Trailing `\` at end-of-input emitted as text (escape scanner contract).
- `\` followed by `\n` left as text for the hard-line-break post-pass to claim (`post-process.ts`).
