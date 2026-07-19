# Feature: Plugin Container — :::note Callout Editability

The `:::note` callout is a plugin-authored container built by mirroring the
built-in blockquote (WS-B Cycle 1). It reserves child 0 as an editable
`note-title` chrome leaf (Fork-A spike), so its children are `[title, ...body]`.
Editing inside it must mutate the callout's own children through the
nested-container wiring — never the document root — and never break byte-for-byte
round-trip fidelity. This gate is behavioral: it asserts the CST read by path via
`window.__test`, not visuals.

## Happy paths

- callout parses as container: the seeded `:::note Title` is a `note` block at document root whose children are `[note-title, paragraph]`
- type inside callout: typing at the end of the callout's body paragraph appends to that child; the title stays put and the document root keeps one block
- split inside callout: Enter mid-body splits that body paragraph, growing the callout to three children — the document root still holds exactly one block (the discriminator: a broken container grows the root instead)

## Edge cases

- merge inside callout: Backspace at the start of the callout's last child merges it back into the previous body paragraph — never into the title
- undo after merge: Ctrl+Z restores the three-child split state captured before the merge
- undo after split-typing: a second Ctrl+Z steps back to the state captured before the last text was typed
- round-trip stays stable: after every structural edit the document still serializes byte-for-byte (the non-strip callout rebuilds its own raw, title included)
- cross-block copy ending mid-title: drag-selecting from the prose above into the middle of the title and copying synthesizes closer bytes — pasting below yields a second real `note` container, not bare paragraphs

## User interactions

- click into callout body, End, type: real keyboard input lands in the callout body child, not the title
- Enter / Home+Backspace / Ctrl+Z / drag-select + copy + paste are real keystrokes and pointer events, each asserted against the CST read by path (`[0]`, `[0,n]`) — not the DOM
