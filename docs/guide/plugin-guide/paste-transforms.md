# Paste transforms

Part of the [plugin guide](../plugin-guide.md).

`registerPasteTransform` records a **content-keyed, pre-parse** rewrite of pasted plain text. Each transform is a `{ name, transform(text) }` unit: `transform` returns a replacement string, or `null` to decline ("not mine"). Transforms run on every paste before the clipboard text is parsed, in **install order**, each one seeing the previous transform's output, so a plugin keys off the _content_ it recognizes rather than the block it lands in. The first one always gets LF line breaks, even when the clipboard held CRLF (hi, Windows), so a `^...$` pattern with the `m` flag just works. The name is register-once, like every other registration.

```ts
registerPasteTransform({
	name: 'shout',
	transform: (text) => (text.includes('!!') ? text.toUpperCase() : null)
});
// pasting 'wow!! ok' inserts 'WOW!! OK'
// pasting 'calm' inserts 'calm': the transform declined, so the text went through untouched
registerPasteTransform({ name: 'shout', transform: () => null }); // throws: "shout" is already registered
```

Two habits keep a transform sound:

- **Decline cheaply, then convert precisely.** Probe the text for your marker first and return `null` when it's absent. The pipeline runs on every paste, so a fast reject keeps the common case free.
- **Scope through the parser, not a naive text scan.** A line-level scanner rewrites marker-shaped lines that happen to sit inside a pasted code fence; a converter that parses first and rewrites only the blocks it means to leaves the fence alone.
- **Keep it idempotent**, meaning re-running it on its own output must decline or reproduce it. A dev build checks that on every paste and warns otherwise.

A transform that throws doesn't take the paste down with it: it counts as a decline, the text carries on untouched, and a dev build warns.

The admonitions plugin is the worked example: with `admonitionsPlugin({ convertAlertsOnPaste: true })` (default off) it converts pasted top-level `> [!NOTE]` GitHub alerts to `:::name` directive source, through a converter that parses first, so an alert-shaped line inside a pasted fence survives as is.
