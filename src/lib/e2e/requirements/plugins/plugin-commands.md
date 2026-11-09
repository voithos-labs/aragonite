# Feature: a plugin value's command chord

A plugin value lists `commands` in what it contributes, and a command with a `chord` runs when that
chord is pressed anywhere in an editor that lists the plugin. The `chord-count` plugin's one command
counts its presses under the editor's `label` option in `window.__chordCounts`, and every scenario
reads that count, driven by real keyboard and mouse input. Single-editor scenarios run on
`/test/plugins?seed=docstats`, labeled `default`; the two-editor one runs on `/test/plugins/multi`,
whose editors are labeled `left` and `right`. Which editor claims the chord at all is
`plugins-prop-activation.md`.

## Happy paths

- `Mod+Shift+S` pressed from a focused paragraph runs the command once

## Edge cases

- the command still runs after an Enter split and an undo, so the editor's keymap survives a
  structural edit
- with two editors listing the plugin with their own options, the chord runs only in the editor
  holding the caret, with that editor's options: `right` counts one and `left` none

## Error cases

- none: this spec must trigger no invariants
