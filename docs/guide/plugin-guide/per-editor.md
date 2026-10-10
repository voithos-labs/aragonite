# One process, many editors

Part of the [plugin guide](../plugin-guide.md). It builds on [the plugin unit](../plugin-guide.md#the-plugin-unit), where `setup`, `defaults` and the `plugins` prop come from.

`setup` runs once per process, but a plugin usually needs to react to _each editor_: recompute derived state on every edit, hold per-document data, read the options a given editor passed. `ctx.onEditor(cb)` is that entry point. It registers a callback fired once per mounted `<Editor>` that listed your plugin (or that has no `plugins` prop, since those activate everything), handed that instance's **`EditorContext`**:

```ts
setup(ctx) {
	ctx.onEditor((editor) => {
		editor.editorId; // 'editor-1' (the next editor to mount gets 'editor-2')
		editor.document.children.length; // 3, and live: read it again later and you get the current count
		editor.presentationMode; // 'source'
		editor.theme; // 'dark'
		return () => {}; // runs at unmount
	});
}
```

| Field                          | What it gives you                                                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `editorId`                     | A stable per-mount id. Key your own `Map` / `WeakMap` on it for per-editor state                                                                                                                                                                                                     |
| `document`                     | A live getter for the root document, as a read-only `DocumentView` ([Views](../plugin-guide.md#views-what-you-read-what-you-own))                                                                                                                                                    |
| `documentGeneration`           | How many times a `source` write has replaced the document, live but not reactive: subscribe to the `sourceSwap` event to hear a change                                                                                                                                               |
| `events`                       | The subscribe-only event view; `events.on('edit', …)` returns a disposer                                                                                                                                                                                                             |
| `options`                      | Your `defaults` with this editor's options merged over them (just the defaults if it passed none), typed by your `defaults` or by `definePlugin<Options>` (recipe below)                                                                                                             |
| `decorations`                  | This editor's decoration registry, where you register a source ([Decorations](decorations.md#decorations))                                                                                                                                                                           |
| `rects`                        | This editor's viewport-space geometry: block box, range rects, caret, reveal, `scrollTo`, `navigateTo`                                                                                                                                                                               |
| `inlineMenus`                  | This editor's registry for lists opened by a typed trigger ([Recipe: a typed-trigger menu](../consumer-guide.md#recipe-a-typed-trigger-menu))                                                                                                                                        |
| `insertCatalogue`              | The blocks this editor's insert menus offer, live, yours included once you `registerInsertEntry` from `setup`                                                                                                                                                                        |
| `insertMarkdown(md, options?)` | Insert Markdown the way the instance's own call does ([Inserting Markdown at the caret](../consumer-guide.md#inserting-markdown-at-the-caret)); a promise that resolves false where that call would                                                                                  |
| `runCommand(id, arg?)`         | Run a command by id the way the instance's own call does; false where that would be                                                                                                                                                                                                  |
| `openDraft(spec)`              | Hold an edit outside the document (a textarea's text) so a host loading another note can't land it in the wrong one ([What your own editing surface has to do](render-primary.md#what-your-own-editing-surface-has-to-do))                                                           |
| `computeInlineContent(node)`   | Parse a prose block's inline content the way this editor draws it: syntax from a plugin its `plugins` prop left out comes back as plain text, and reference links resolve against the document's link definitions (its `[r]: /x` lines). Reach for it wherever you walk inline nodes |
| `presentationMode`             | The effective presentation mode, live, paired with the `presentationModeChange` event ([Presentation modes](presentation-modes.md#presentation-modes))                                                                                                                               |
| `theme`                        | The editor's theme name, live, paired with the `themeChange` event, for content whose colors an engine paints                                                                                                                                                                        |

Return a disposer from the callback and the editor runs it at unmount. Registration is synchronous-only: call `onEditor` from `setup`, since a call after `setup` returns throws.

## Recipe: per-instance derived state

There's no plugin-state field on the platform, and you don't need one. Keep your own map keyed on `editorId`, seed it when the editor mounts, recompute on the `edit` event, and delete the entry in the disposer. That's the whole feature.

```ts
import { definePlugin, type EditorContext } from '@voithos-labs/aragonite/plugin';

interface WordCountOptions {
	live: boolean; // recount on every edit, or only at mount
}

// Per-editor state lives in a plugin-owned map, not a platform field.
const countByEditor = new Map<string, number>();

function recount(editor: EditorContext<WordCountOptions>): void {
	const words = editor.document.children.reduce(
		(n, block) => n + block.raw.split(/\s+/).filter(Boolean).length,
		0
	);
	countByEditor.set(editor.editorId, words);
}

export const wordCountPlugin = definePlugin<WordCountOptions>({
	name: 'word-count',
	defaults: { live: true }, // what a bare-unit install reads
	setup(ctx) {
		ctx.onEditor((editor) => {
			const { live } = editor.options;
			recount(editor); // seed on mount
			const off = live ? editor.events.on('edit', () => recount(editor)) : () => {};
			return () => {
				off();
				countByEditor.delete(editor.editorId); // per-editor cleanup
			};
		});
	}
});
```

## Recipe: per-instance options (and the factory-closure trap)

Two editors share one process-global registration but may still want different options; a split-pane host is the classic case. The consumer varies them per editor through the `plugins` prop's entry form:

```svelte
<Editor source={left} plugins={[{ plugin: wordCountPlugin, options: { live: true } }]} />
<Editor source={right} plugins={[{ plugin: wordCountPlugin, options: { live: false } }]} />
```

Whatever an editor passes lands on your `defaults` one field at a time. A field it passes replaces yours whole (an array too, nothing gets concatenated), and a field it leaves out keeps its default. The bundled slash commands plugin shows it best, since its factory argument is its `defaults`:

```ts
const stamp = { id: 'stamp', label: 'Stamp', insert: 'approved' }; // one host row
slashCommandsPlugin({ entries: [stamp] }); // defaults: { entries: [stamp] }

// this editor's options      editor.options
// (none, a bare unit)        { entries: [stamp] }
// { exclude: ['table'] }     { entries: [stamp], exclude: ['table'] }
// { entries: [] }            { entries: [] }
```

`definePlugin<WordCountOptions>` carries the type through, so `editor.options` reads typed inside `onEditor` with no cast. The type is your word, though, not a check. What checks is **`parseOptions(raw)`**: it gets an editor's options exactly as the host wrote them (once per editor, and only if the host wrote some) and returns the fields to apply. Leave a field out and it keeps its default. Throw, and the editor reports it on its `error` event (origin `subscriber`, naming your plugin) and runs your plugin on its defaults, so somebody's typo never takes their document down.

```ts
export const wordCountPlugin = definePlugin<WordCountOptions>({
	name: 'word-count',
	defaults: { live: true },
	parseOptions(raw) {
		const live = (raw as Partial<WordCountOptions> | null)?.live;
		return typeof live === 'boolean' ? { live } : {}; // { live: 'yes' } keeps live: true
	},
	setup(ctx) {
		/* the recipe above */
	}
});
```

**The trap.** Don't hold per-instance config in the plugin factory's closure. `wordCountPlugin({ live: false })` looks like it configures the instance, but a plugin installs once per process, so only the first editor's factory value ever takes effect (a dev build warns; production says nothing). The question that decides it: _would two editors ever want different values?_ If yes, pass it through the prop entry and read `editor.options`. If no (a render engine, a shared parser), the factory argument is the right home. A factory argument that fills `defaults` is fine too, since each editor's entry can still override it.
