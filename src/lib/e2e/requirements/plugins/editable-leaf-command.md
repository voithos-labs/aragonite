# Feature: Minted block commands on the editable-leaf tier

A plugin mints a `(kind, id)` block command and binds it on a `createEditableLeaf`
kind's keymap. Pressing the bound chord over the focused leaf resolves the command
through the same seam the container-bubble path uses, running it against the focused
node and a metadata-commit route. A handler that throws is contained at the dispatch
seam — the gesture becomes a no-op that surfaces an `origin: 'command'` error on the
editor's event channel, never an uncaught page error. Seed: the `%%` memo harness
kind (commands `memo.tag` on `Mod+Shift+K`, `memo.boom` on `Mod+Shift+J`), driven by
real keyboard only.

## Happy paths

- A minted command bound on the memo leaf fires on the leaf path: pressing its chord
  over the focused memo runs the handler, which commits one metadata edit through the
  sanctioned update route (the leaf dead-keyed such commands before this tier existed)

## Error cases

- A minted handler that throws is contained: pressing its chord surfaces exactly one
  `error` event of origin `command` on `getEvents()`, no uncaught `pageerror` fires,
  and the editor stays interactive (the next keystroke still commits)
