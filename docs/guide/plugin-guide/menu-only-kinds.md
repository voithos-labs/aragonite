# Recipe: a kind only a menu creates

Part of the [plugin guide](../plugin-guide.md).

Some kinds shouldn't be typeable: a chart card, a survey embed, a citation block whose author picks it from a menu rather than remembering syntax. The move is **not** to register a kind with no grammar. The saved file is just bytes, and on reload the parser is the only way back in, so a kind whose bytes no opener recognizes survives exactly until the document is saved and reloaded, then comes back as prose.

Own a `:::name` directive instead. The grammar is real, so the bytes reload as your kind, and the syntax is implausible to arrive at by typing: it needs three colons, a name, a body and a `:::` terminator, and nothing along the way paints a half-formed block. That's as close to "not typeable" as an editor that reloads from bytes can honestly get, and it costs you nothing, since the [directive walkthrough](container-walkthrough.md#walkthrough-a-conspiracy-container-end-to-end) is the same registration you'd have written anyway.

Creation then comes from the host's own UI. The consumer's `editor.insertMarkdown(md)` inserts your kind's canonical bytes at the caret as pasting them would (its last line ending ends the snippet, so the caret stays in your block), so a menu entry is:

```ts
editor.insertMarkdown(':::chart\ntype: bar\n:::\n');
```

That snippet is the whole integration: a new kind adds no method for the host to adopt. The call answers `true` when the caret took the paste and `false` with no caret (reading mode included). Do document your canonical snippet beside the kind: give the host the exact bytes your `rebuildRaw` would produce, so the first insertion is already canonical.

Or skip the host's UI and put your kind in the editor's own menus: call `registerInsertEntry` from your `setup`, and the kind shows up in the right-click "Insert block" rows, and in the `/` list where the slash commands plugin is on, in every editor that lists your plugin.

```ts
registerInsertEntry({
	id: 'chart',
	label: 'Chart',
	icon: 'workflow',
	keywords: ['graph', 'plot'],
	markdown: ':::chart\ntype: bar\n:::\n',
	withArgument: (type) => ({ markdown: `:::chart\ntype: ${type}\n:::\n`, detail: type })
});
```

`withArgument` is optional. Give it one when a word typed after the row should shape the block: `/chart pie` inserts a pie chart, and `detail` is the dim text the row shows while you type (`pie` here). The word reaches your row when what's typed before the space is your label's first word or one of your keywords, even with other rows starting the same way (a Diagram row with a `chart` keyword, say). Two exceptions. A row whose label starts with everything you typed, spaces and all, gets listed instead, so a label typed in full always finds its row. And if another row that takes a word has that same word, neither of you gets it, and the space closes the list.
