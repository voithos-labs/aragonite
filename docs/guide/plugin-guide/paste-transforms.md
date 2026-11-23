# Paste transforms

Part of the [plugin guide](../plugin-guide.md).

A plugin value rewrites a paste two ways: the whole paste, before the editor reads where it lands (`pasteRewrites`), and each pasted block of one type, where the paste lands as blocks (`blockRewrites`). The whole-paste ones run first.

**A plugin value's `pasteRewrites`**

```ts
const shout = pasteRewrite({
	name: 'shout',
	sample: 'wow!! ok',
	into: (pasted) => (pasted.text.includes('!!') ? pasted.text.toUpperCase() : null)
});

definePlugin({ name: 'shout', /* ... */ contributes: () => ({ pasteRewrites: [shout] }) });
// pasting 'wow!! ok' inserts 'WOW!! OK', after text on its line too
// pasting 'calm' inserts 'calm': the rewrite kept it
```

`into` gets the paste as a `Doc`: its `text`, with LF line endings, and its blocks. It answers the Markdown to paste instead, `''` to paste nothing, or `null` to keep the paste. The editor lands the answer the way it lands any paste, so one line can come back as blocks, and several lines as one line of text. `name` names the rewrite's `check` row and is unique in your plugin; `sample` is a paste it rewrites, which `check` pastes.

Every paste is read, wherever it lands: one line after text, a table cell, a code block. The whole-paste rewrites of every listed plugin chain in list order, each reading the paste as the one before left it, so `pasted.text` is the clipboard's own text only for the first. A rewrite that throws reaches `onError` as `rewrite paste` and keeps the paste; the rest still run. An answer of `''` ends the chain, and nothing is pasted.

**A plugin value's `blockRewrites`**

A rewrite by type names a block type in `from`, and `into` answers the Markdown that takes a pasted block's place: `''` leaves it out, with a list item or quote that then holds nothing, and `null` keeps it. A paste whose every block is left out writes nothing, even over a selection.

```ts
const alertToCallout = blockRewrite({
	from: alert,
	into: (block) => `:::${block.data.type.toLowerCase()}
${block.children.map((c) => c.text).join('')}:::`
});

definePlugin({ name: 'alerts', /* ... */ contributes: () => ({ blocks: [alert], blockRewrites: [alertToCallout] }) });
// pasting '%> [!TIP]
%> hi
' on an empty line inserts ':::tip
hi
:::'
```

Write it with `blockRewrite()`, so `block.data` has `from`'s type; a bare object literal can't infer it. `into` also gets the paste as `ctx.pasted`, as the whole-paste rewrites left it, so a rewrite can decide on the blocks around its own (`ctx.pasted.blocks.length === 1` when the block is the whole paste). A block's positions count from the start of `ctx.pasted.text`, not the document.

A rewrite by type runs where a paste lands as blocks, at any depth: a block inside a pasted list item gets the item's indent on each line of its answer. An answer that would read into the block right above or below it (plain text under a paragraph, `---` under one) gets a blank line there, so it stays a block of its own. The outermost block of a listed type is the one asked, and the first listed rewrite that answers takes it. Its answer is never offered to a rewrite again, so it can't loop. A rewrite that throws reaches `onError` as `rewrite paste`, and the block stays as pasted.

A paste that goes in as text is never read by a rewrite by type: one line pasted after text on its line, text pasted into a table cell, anything pasted into a title row or a code block. (Blocks pasted into a table cell split the table and land between the halves, so they are.)

Neither form reads Paste as plain text, or a copy or cut the editor made with the keyboard, whether Ctrl+V or Replace with clipboard pastes it, or anything dragged and dropped. Markdown a program puts in itself is not a paste either: a draft's `insert` and `insertBelow`, a menu pick's inserts and a right-click Insert row go in as written, your own rewrites included. `insertMarkdown` is the one insert both forms read, since it stands for a paste.

**`registerPasteTransform`**

A `setup` plugin's way. It records a **content-keyed, pre-parse** rewrite of pasted plain text. Each transform is a `{ name, transform(text) }` unit: `transform` returns a replacement string, or `null` to decline ("not mine"). Transforms run where a paste lands as blocks, after the plugin values' rewrites by type and before the clipboard text is parsed, in **install order**, each one seeing the previous transform's output, so a plugin keys off the _content_ it recognizes rather than the block it lands in. They skip the same pastes the rewrites by type skip. The first one always gets LF line breaks, even when the clipboard held CRLF (hi, Windows), so a `^...$` pattern with the `m` flag just works. The name is register-once, like every other registration.

```ts
registerPasteTransform({
	name: 'shout',
	transform: (text) => (text.includes('!!') ? text.toUpperCase() : null)
});
// pasting 'wow!! ok' on an empty line inserts 'WOW!! OK'
// pasting 'calm' inserts 'calm': the transform declined, so the text went through untouched
registerPasteTransform({ name: 'shout', transform: () => null }); // throws: "shout" is already registered
```

Three habits keep a transform sound:

- **Decline cheaply, then convert precisely.** Probe the text for your marker first and return `null` when it's absent. The pipeline runs on every paste that lands as blocks, so a fast reject keeps the common case free.
- **Scope through the parser, not a naive text scan.** A line-level scanner rewrites marker-shaped lines that happen to sit inside a pasted code fence; a converter that parses first and rewrites only the blocks it means to leaves the fence alone.
- **Keep it idempotent**, meaning re-running it on its own output must decline or reproduce it. A dev build checks that on every paste and warns otherwise.

A transform that throws doesn't take the paste down with it: it counts as a decline, the text carries on untouched, and a dev build warns.

The admonitions plugin is the worked example: with `admonitionsPlugin({ convertAlertsOnPaste: true })` (default off) it converts pasted top-level `> [!NOTE]` GitHub alerts to `:::name` directive source, through a converter that parses first, so an alert-shaped line inside a pasted fence survives as is.
