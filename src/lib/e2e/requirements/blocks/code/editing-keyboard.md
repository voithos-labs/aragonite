# Feature: Code Block Keyboard Parity

Keyboard behavior inside a code block that diverges from text-block parity: bold/italic shortcuts, horizontal-arrow focus exit, sticky-column preservation, and literal-newline Shift+Enter.

## Keyboard — beyond parity

- Ctrl+B and Ctrl+I are no-ops inside a code block: no `<b>`/`<i>`/`<strong>`/`<em>` elements appear in the DOM, source is unchanged
- ArrowLeft at offset 0 moves focus to end of previous block
- ArrowRight at end of content moves focus to start of next block
- vertical arrow sticky column preserved through code block: cursor at column 20 in a paragraph above a code block, after ArrowDown through the code block and into a paragraph below, still lands near column 20
- Shift+Enter inserts a newline text node (not a `<br>`): pressing Shift+Enter inside a code block produces no `<br>` elements

## Copy

- selection inside a code block copies verbatim — fence markers at the boundaries stay on the clipboard, no silent stripping. Round-tripping a copy into another code block is handled by the paste-side fence bump; copying a lone fence yields the fence on the clipboard, not an empty string
