# Feature: Plain-mode editable leaf — the `%%` memo harness kind

A `memo` leaf built on `createEditableLeaf({ mode: 'plain' })` is an always-editable
text surface with native parity: per-keystroke CST commits, prose-like undo batching,
arrow traversal across block boundaries, and cross-block selection sweeping through
it. Driven through real keyboard/mouse only — the tier's whole claim is that a plugin
leaf behaves like a built-in text block. Seed: `Before` / `%% memo text` / `After`.

## Happy paths

- Typing into the memo commits per keystroke: the typed characters land in the CST
  raw, round-trip stable
- Enter inside the memo inserts a literal newline; the second line no longer matches
  the `%%` recognizer, so the commit re-splits into memo + paragraph (the commit
  kernel through the plain leaf)

## User interactions

- ArrowRight from the previous block's end enters the memo at its start; ArrowRight
  from the memo's end exits to the next block; ArrowDown/ArrowUp traverse through
- A cross-block selection swept from the block above through the memo into the block
  below enters cross-block mode spanning all three

## Clipboard

The leaf intercepts copy/cut/paste with the same parity as every other editable surface
(`editor.md` § Clipboard) — the tier is the clipboard owner, so a plugin leaf inherits
the rule without wiring it.

- A single-block paste is intercepted, not native: only `text/plain` is taken, so HTML on
  the clipboard is stripped instead of landing as live markup, and multiline text keeps
  its newlines (the second line re-splits off as a paragraph through the commit kernel)
- Cross-block copy with the memo as the focused anchor reaches the shared cross-block
  collector, which reads the memo's own raw plus the swept neighbour — not a bare
  single-element copy
- Cross-block cut with the memo as the focused anchor writes the same payload and
  deletes the swept range, collapsing the cross-block selection
- Paste over a cross-block selection anchored in the memo routes through the cross-block
  delete-then-paste, collapsing the selection and landing the pasted text in one entry

## Edge cases

- Undo batches like prose: a burst of typed characters undoes in one step back to the
  pre-typing text
