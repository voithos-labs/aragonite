# Feature: Plugin Container — :::note Callout Editability

The `:::note` callout is a plugin-authored container built by mirroring the
built-in blockquote (WS-B Cycle 1 spike). Editing inside it must mutate the
callout's own children through the nested-container wiring — never the document
root — and never break byte-for-byte round-trip fidelity. This gate is
behavioral: it asserts the CST read by path via `window.__test`, not visuals.

## Happy paths

- callout parses as container: the seeded `:::note` is a `note` block at document root with one paragraph child
- type inside callout: typing at the end of the callout's paragraph appends to that child; callout stays a single-child container and the document root keeps one block
- split inside callout: Enter mid-content splits the callout's paragraph into two paragraph children of the callout — the document root still holds exactly one block (the discriminator: a broken container grows the root instead)

## Edge cases

- merge inside callout: Backspace at the start of the callout's second child merges it back into the first, restoring a single child
- undo after merge: Ctrl+Z restores the two-child split state captured before the merge
- undo after split-typing: a second Ctrl+Z steps back to the state captured before the last text was typed
- round-trip stays stable: after every structural edit the document still serializes byte-for-byte (guards against stale-raw container corruption)

## User interactions

- click into callout, End, type: real keyboard input lands in the callout child
- Enter / Home+Backspace / Ctrl+Z are real keystrokes, each asserted against the CST read by path (`[0]`, `[0,n]`) — not the DOM
