# Feature: Sticky column — rapid cross-block navigation timing

Consecutive vertical-arrow presses without settling time must still cross block boundaries. The `isAtFirstVisualLine` / `isAtLastVisualLine` geometry checks must tolerate back-to-back keypresses without leaking intermediate layout state — especially when the block's firstChild or lastChild is a non-text node (heading markers, dimmed markup spans).

## Edge cases

- Rapid ArrowUp across a stack of headings crosses all boundaries; a trailing typed marker lands in the first heading
- Rapid ArrowDown across a stack of headings crosses all boundaries; a trailing typed marker lands in the last heading
- Rapid ArrowUp across plain paragraphs crosses all boundaries; a trailing typed marker lands in the first paragraph
- Rapid ArrowDown across plain paragraphs crosses all boundaries; a trailing typed marker lands in the last paragraph
- Rapid ArrowUp across paragraphs whose first child is a markup span (`**bold** …`) crosses all boundaries; the marker lands in the first paragraph
- Rapid ArrowDown across paragraphs whose last child is a markup span (`… **bold**`) crosses all boundaries; the marker lands in the last paragraph
