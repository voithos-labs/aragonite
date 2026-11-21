# Feature: a block type's keys and menu rows

A plugin value's block type lists `chords` and `actions`, each running a command on its block. The
alerts plugin's `%> [!TYPE]` container binds `Mod+7` and offers a "Next kind" row, both moving the
head line to the next type; its `[[flag on]]` line, a block picked up whole, offers "Toggle flag".
Every scenario runs on `/test/plugins?seed=alerts` with real clicks and keys. The host's rebinding
and `claimsChord` are held by `plugin-block-commands.svelte.test.ts`, a greyed row by
`editor-root/menus.test.ts`.

Miss-analysis: block commands ran only through the process-wide `registerBlockCommand`, so no spec
pressed a value plugin's block key, and a container type's key never reached the container walk.

## Happy paths

- `Mod+7` in the paragraph inside the alert moves `[!NOTE]` to `[!TIP]`, and one undo puts it back
- A right-click on the flag line lists "Toggle flag" before "Copy flag", and the row flips the flag
- A right-click in the alert's paragraph leads with an "Alert" flyout above Cut; its "Next kind"
  moves `[!NOTE]` to `[!TIP]`
- The same flyout over an alert inside a list item cycles that alert

## Edge cases

- `Mod+7` in a paragraph outside any alert changes nothing
- `Enter` in the alert's paragraph splits the paragraph, since a key the paragraph binds itself runs
  before its container's

## Error cases

- none: this spec must trigger no invariants
