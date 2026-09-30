# Feature: Code Block Keyboard Parity

Keyboard behavior inside a code block where it differs from a text block: the bold and italic shortcuts, moving focus out with the horizontal arrows, keeping the sticky column, and Shift+Enter inserting a literal newline.

## Keyboard: beyond parity

- Ctrl+B and Ctrl+I are no-ops inside a code block: no `<b>`/`<i>`/`<strong>`/`<em>` elements appear in the DOM, source is unchanged
- ArrowLeft at offset 0 moves focus to end of previous block
- ArrowRight at end of content moves focus to start of next block
- vertical arrow sticky column preserved through code block: cursor at column 20 in a paragraph above a code block, after ArrowDown through the code block and into a paragraph below, still lands near column 20
- Shift+Enter inserts a newline text node (not a `<br>`): pressing Shift+Enter inside a code block produces no `<br>` elements

## Copy

- a selection inside a code block copies verbatim: the fence markers at its edges stay on the clipboard, nothing is quietly stripped. Pasting such a copy into another code block is handled by the paste side bumping the fence; copying a lone fence puts the fence on the clipboard, not an empty string
