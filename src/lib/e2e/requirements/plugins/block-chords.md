# Feature: a block type's key

A plugin value's block type lists `chords`, each running a command on its block. The alerts plugin's
`%> [!TYPE]` container binds `Mod+7` to a command that moves the head line to the next type. Every
scenario runs on `/test/plugins?seed=alerts` with real clicks and keys. The host's rebinding and
`claimsChord` are held by `plugin-block-commands.svelte.test.ts`.

Miss-analysis: block commands ran only through the process-wide `registerBlockCommand`, so no spec
pressed a value plugin's block key, and a container type's key never reached the container walk.

## Happy paths

- `Mod+7` in the paragraph inside the alert moves `[!NOTE]` to `[!TIP]`, and one undo puts it back

## Edge cases

- `Mod+7` in a paragraph outside any alert changes nothing
- `Enter` in the alert's paragraph splits the paragraph, since a key the paragraph binds itself runs
  before its container's

## Error cases

- none: this spec must trigger no invariants
