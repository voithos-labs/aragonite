# Feature: doc-stats plugin, per-instance context all the way through

The `doc-stats` dogfood proves the per-instance context all the way through: `onEditor` receives
an `EditorContext` for that one editor (editorId, live document, subscribe-only events, typed
options), a global command chord resolves against the instance that dispatched it, and the
disposer runs on unmount. The plugin writes its registry to `window.__docStats`, one record per
live editor holding a label, a block count and a running edit count, and every scenario asserts
through that record, driven by real keyboard and mouse input. Single-editor scenarios run on
`/test/plugins?seed=docstats`; the ones with two editors run on `/test/plugins/multi`, which
mounts two editors with the same plugin, labeled left and right.

## Happy paths

- onEditor fires once per editor instance with a live document: the stats match the seeded content
- an edit event recomputes the stats: typing updates the record's edit count while the block count holds
- the global chord (Mod+Shift+S), pressed from a focused paragraph, writes stats for the instance that received the keypress

## Edge cases

- the plugin stays attached across a structural edit: after an Enter split and an undo, the edit
  subscription still fires and the chord still resolves. This pins a class of bug in the mount
  wiring: if it were a tracking effect, the plugin's setup would be disposed or run again on the
  first change to the children, resetting the running edit count its closure holds
- two editors, the same plugin, different options: each instance's record carries its own option value and its own editorId
- with two live editors, the chord recomputes only the record of the instance that received it;
  the other editor's record keeps the value it already had
- unmounting an editor runs the disposer: its record is removed from the registry, driven by the
  unmount toggle on the two-editor page

## Error cases

- none: error containment has unit tests, and this spec must trigger no invariants
