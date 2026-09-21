# Feature: Plugin container: editing inside a `:::callout`

The `:::callout` callout is a container a plugin defines, built the same way as the built-in
blockquote. It reserves child 0 as an editable `callout-title` leaf, so its children are
`[title, ...body]`. Editing inside it has to change the callout's own children through the
nested-container wiring, never the document root, and it must never break byte-for-byte
round-trip fidelity. These checks read behavior: they assert the tree read by path through
`window.__test`, not visuals.

## Happy paths

- callout parses as container: the seeded `:::callout Title` is a `callout` block at the document root whose children are `[callout-title, paragraph]`
- type inside callout: typing at the end of the callout's body paragraph appends to that child; the title stays put and the document root keeps one block
- split inside callout: Enter mid-body splits that body paragraph, growing the callout to three children, and the document root still holds exactly one block. That last count is what tells the two outcomes apart: a broken container grows the root instead

## Edge cases

- merge inside callout: Backspace at the start of the callout's last child merges it back into the previous body paragraph, never into the title
- undo after merge: Ctrl+Z restores the three-child split state captured before the merge
- undo after split-typing: a second Ctrl+Z steps back to the state captured before the last text was typed
- round-trip stays stable: after every structural edit the document still serializes byte for byte (the callout rebuilds its own raw text, title included, rather than stripping it)
- cross-block copy ending mid-title: drag-selecting from the prose above into the middle of the title and copying builds the closing bytes the selection is missing, so pasting below yields a second real `callout` container rather than bare paragraphs

## User interactions

- click into callout body, End, type: real keyboard input lands in the callout body child, not the title
- Enter, Home+Backspace, Ctrl+Z, and drag-select plus copy and paste are real keystrokes and pointer events, each asserted against the tree read by path (`[0]`, `[0,n]`) rather than against the DOM

## Error cases

- another route rendered first: the seed still parses to a `callout` however many other routes the dev or SSR process served before this one. The unit test `route-grammar-order.test.ts` pins this, because whether the e2e battery ever reaches the bad order depends on file sort order and how work is spread across workers.

Miss-analysis: a test asserting that a route document's parse does not depend on which other route's plugin set was installed first would have caught it; none existed, because every plugin-grammar test installed one set into a clean process, which is the one arrangement a shared dev-server process never has.
