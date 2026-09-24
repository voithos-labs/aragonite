# Feature: A marker typed at a line start

Typing a list, quote or task marker in front of existing text turns the block into a container, and the key typed next lands where the user was typing: at the start of the text the container now holds.

## Happy paths

- `- ` then a key at the start of `abcdef`: `- Qabcdef` (regression: the key landed at the end, `- abcdefQ`; miss-analysis: the caret restore after a kind change handed the container a raw offset, which names no caret position, and every typing test that made a container typed into an empty line, where the end and the start are the same place)
- `> ` then a key: `> Qabcdef`; the space right after a bare `>` completes the marker instead of landing as a leading space in the text (regression: `> abcdef Q`)
- `1. ` then a key: `1. Qabcdef`
- `- [ ] ` then a key: `- [ ] Qabcdef` (regression: `- abcdef[ ] Q`)
- `# ` then a key: `# Qabcdef`, the leaf case that always held

## Edge cases

- `[ ] ` typed at the start of an existing item's text makes it a task and the key lands before the text (regression: `- [ ] abcdQef`; miss-analysis: the item moves the marker out of its paragraph, and the caret restore after a container rewrite knew only the body-write rule)
- `- ` typed before a paragraph under a list joins that list and the key lands in the new item (regression: `- abcdefQ`)
- `> ` typed before a paragraph inside a list item makes a quote in the item and the key lands inside it (regression: `> abcdef Q`)

## User interactions

- a pasted space completing `-abcdef` into a bullet: the key lands before the text (regression: `- abcdefQ`)
- a space typed or pasted over a range from one block into the next, joining `-` to `abcdef`: the key lands before the text (regression: the key was lost, `- abcdef`)
