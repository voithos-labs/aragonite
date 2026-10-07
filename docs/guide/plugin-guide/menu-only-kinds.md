# Recipe: a kind only a menu creates

Part of the [plugin guide](../plugin-guide.md).

Some kinds shouldn't be typeable: a chart card, a survey embed, a citation block whose author picks it from a menu rather than remembering syntax. The move is **not** to register a kind with no grammar. The saved file is just bytes, and on reload the parser is the only way back in, so a kind whose bytes no opener recognizes survives exactly until the document is saved and reloaded, then comes back as prose.

Own a `:::name` directive instead. The grammar is real, so the bytes reload as your kind, and the syntax is implausible to arrive at by typing: it needs three colons, a name, a body and a `:::` terminator, and nothing along the way paints a half-formed block. That's as close to "not typeable" as an editor that reloads from bytes can honestly get, and it costs you nothing, since the [directive walkthrough](container-walkthrough.md#walkthrough-a-conspiracy-container-end-to-end) is the same registration you'd have written anyway.

Creation then comes from the host's own UI. The consumer's `editor.insertMarkdown(md)` inserts your kind's canonical bytes at the caret exactly as pasting them would, so a menu entry is:

```ts
editor.insertMarkdown(':::chart\ntype: bar\n:::\n');
```

That snippet is the whole integration: a new kind adds no method for the host to adopt. The call answers `true` when the caret took the paste and `false` with no caret (reading mode included). Do document your canonical snippet beside the kind: give the host the exact bytes your `rebuildRaw` would produce, so the first insertion is already canonical.
