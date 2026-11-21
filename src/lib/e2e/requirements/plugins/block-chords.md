# Feature: a block type's keys and menu rows

A plugin value's block type lists `chords` and `actions`, each running a command on its block. The
alerts plugin's `%> [!TYPE]` container binds `Mod+7` and offers a "Next kind" row, both moving the
head line to the next type, which a `[!LOCKED]` alert refuses; its `[[flag on]]` line, a block
picked up whole, offers "Toggle flag". Every scenario runs on `/test/plugins?seed=alerts` with real
clicks and keys. The host's rebinding and `claimsChord` are held by
`plugin-block-commands.svelte.test.ts`.

Miss-analysis: block commands ran only through the process-wide `registerBlockCommand`, so no spec
pressed a value plugin's block key, and a container type's key never reached the container walk.

Miss-analysis (the selection that ends in a paragraph): the one selection row ended inside an alert,
so its key always landed in a block that binds it.

## Happy paths

- `Mod+7` in the paragraph inside the alert moves `[!NOTE]` to `[!TIP]`, and one undo puts it back
- A right-click on the flag line lists "Toggle flag" before "Copy flag", and the row flips the flag
- A right-click in the alert's paragraph leads with an "Alert" flyout above Cut; its "Next kind"
  moves `[!NOTE]` to `[!TIP]`
- The same flyout over an alert inside a list item cycles that alert
- With the menu open, ArrowRight opens the flyout and Enter runs "Next kind"; the menu closes, as
  it does after a click on a row

## Edge cases

- `Mod+7` in a paragraph outside any alert changes nothing
- `Mod+7` over a selection across two alerts cycles each once, and one undo puts both back
- The same over a selection that ends in a plain paragraph below the alerts
- A `[!LOCKED]` alert's "Next kind" row is greyed; picking it, or `Mod+7` in the alert, changes
  nothing
- `Enter` in the alert's paragraph splits the paragraph, since a key the paragraph binds itself runs
  before its container's

## Error cases

- none: this spec must trigger no invariants
