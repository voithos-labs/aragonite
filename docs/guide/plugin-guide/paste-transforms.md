# Paste transforms

Part of the [plugin guide](../plugin-guide.md).

**A plugin value's `rewrites`**

A plugin value rewrites pasted blocks by type. Each rewrite names a block type in `from`, and `into` answers the Markdown that takes a pasted block's place: `''` leaves it out, `null` keeps it.

```ts
const alertToCallout = rewrite({
	from: alert,
	into: (block) => `:::${block.data.type.toLowerCase()}\n${block.children.map((c) => c.text).join('')}:::`
});

definePlugin({ name: 'alerts', /* ... */ contributes: () => ({ blocks: [alert], rewrites: [alertToCallout] }) });
// pasting '%> [!TIP]\n%> hi\n' on an empty line inserts ':::tip\nhi\n:::'
```

Write it with `rewrite()`, so `block.data` has `from`'s type; a bare object literal can't infer it. A block's positions count from the start of the clipboard, not the document.

A rewrite runs where a paste lands as blocks, at any depth: a block inside a pasted list item gets the item's indent on each line of its answer. The outermost block of a listed type is the one asked, and the first listed rewrite that answers takes it. Its answer is never offered to a rewrite again, so it can't loop. A rewrite that throws reaches `onError` as `rewrite paste`, and the block stays as pasted.

A paste that goes in as text is never rewritten: one line pasted after text on its line, text pasted into a table cell, anything pasted into a title row or a code block, and Paste as plain text. Nor is the editor's own copy, whether Ctrl+V or Replace with clipboard pastes it, and nor is anything dragged and dropped. (Blocks pasted into a table cell split the table and land between the halves, so they are rewritten.)

**`registerPasteTransform`**

A `setup` plugin's way. It records a **content-keyed, pre-parse** rewrite of pasted plain text. Each transform is a `{ name, transform(text) }` unit: `transform` returns a replacement string, or `null` to decline ("not mine"). Transforms run where a paste lands as blocks, after the plugin values' rewrites and before the clipboard text is parsed, in **install order**, each one seeing the previous transform's output, so a plugin keys off the _content_ it recognizes rather than the block it lands in. They skip the same pastes the rewrites skip. The first one always gets LF line breaks, even when the clipboard held CRLF (hi, Windows), so a `^...$` pattern with the `m` flag just works. The name is register-once, like every other registration.

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
