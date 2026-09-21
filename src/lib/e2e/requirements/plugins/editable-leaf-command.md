# Feature: plugin-registered block commands on an editable leaf

A plugin registers a `(kind, id)` block command and binds it in the keymap of a kind built with
`createEditableLeaf`. Pressing the bound chord over the focused leaf resolves the command
through the same code the bubble-to-the-container path uses, and runs it against the focused
node and the metadata commit path. A handler that throws is caught where commands are
dispatched: the keypress does nothing and reports one `origin: 'command'` error on the editor's
event channel rather than an uncaught page error. The seed is the `%%` memo harness kind
(commands `memo.tag` on `Mod+Shift+K` and `memo.boom` on `Mod+Shift+J`), driven by real keyboard
input only.

## Happy paths

- A registered command bound on the memo leaf fires on the leaf's own path: pressing its chord
  over the focused memo runs the handler, which commits one metadata edit through the supported
  update path. Before this existed, a leaf ignored such commands

## Error cases

- A registered handler that throws is caught: pressing its chord reports exactly one `error`
  event of origin `command` on `getEvents()`, no uncaught `pageerror` fires, and the editor
  stays usable, so the next keystroke still commits
