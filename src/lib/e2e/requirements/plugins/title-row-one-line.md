# Feature: a title row holds one line

A container's title row is one line: a `:::` container's opener line (`:::tip Title`) or a
`<details>` summary. Shift+Enter at a caret there writes nothing: no bytes, no undo entry, and the caret stays
where it was, so the next letter goes in there. Fixtures in the `/test/plugins` harness; the caret
is walked into the row with ArrowLeft from the body's start.

## Happy paths

- Inside a titled row's title: Shift+Enter writes nothing, and `x` lands where the caret was
- At the title's start, and between the name and the title: the same
- Inside the name, and between the colons and the name: the same, and the container stays a callout
- Before the colons, and between them: the same
- An untitled row, before the colons, at the name's start and inside the name: the same
- A nested callout's row, inside its title: the same, and the outer callout keeps its bytes
- A details summary, inside it: the same
- A paste of `C:\dir\`, a line break and `next` inside a title, or inside a summary: it goes in
  as `C:\dir\ next`, the backslash kept and the break a space, with the caret after it

## Miss-analysis

- No row pressed Shift+Enter on a title row, and only the paste into a title flattened its line,
  so a hard break written into the row by a key, a soft keyboard or a block write went in as typed.
- The paste then took the key's rule and lost a backslash before a pasted break: no row pasted a
  line ending in a backslash, and the one unit row pinned the loss as the rule.
- A title row's keymap had no Shift+Enter, so the key was left to the input event: Playwright
  WebKit sends `insertParagraph`, whose browser edit turned the space before a title into a no-break
  space. No title row ran outside Chromium.
