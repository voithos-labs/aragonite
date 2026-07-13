# Feature: doc-stats plugin — per-instance context spine

The `doc-stats` dogfood proves the context spine end-to-end: `onEditor` receives a
per-instance `EditorContext` (editorId, live document, subscribe-only events, typed
options), a global command chord resolves against the dispatching instance, and the
disposer runs on unmount. The plugin publishes its registry to `window.__docStats`
(one record per live editor: label, block count, cumulative edit count) — every
scenario asserts through that observable, driven by real keyboard/mouse input.
Single-instance scenarios run on `/test/plugins?seed=docstats`; multi-instance
scenarios on `/test/plugins/multi` (two editors, same plugin, labels left/right).

## Happy paths

- onEditor fires once per editor instance with a live document: stats reflect the seeded content
- an edit event recomputes stats: typing updates the record's edit count while the block count holds
- the global chord (Mod+Shift+S) fired from a focused paragraph publishes stats for THAT instance

## Edge cases

- attach survives a structural edit: after an Enter split (and an undo), the edit subscription
  still fires and the chord still resolves — pins the mount-wiring reactivity class (a tracking
  effect would dispose or re-fire the spine on the first children mutation, resetting the
  cumulative edit count its closure carries)
- two editors, same plugin, different options: each instance's record carries its own option value and its own editorId
- with two live editors, the chord recomputes only the dispatching instance's record — the
  sibling's record keeps its stale value
- unmounting an editor runs the disposer: its record is removed from the registry (the multi
  page's unmount toggle is the driver)

## Error cases

- none (containment is unit-covered; this spec must not trigger invariants)
