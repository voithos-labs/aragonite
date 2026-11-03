# @voithos-labs/aragonite-slash-commands

A `/` menu for [aragonite](https://github.com/voithos-labs/aragonite). Type `/` at the start of a line, pick a block from the list that opens, and it lands right where you are; `/td` and Enter, and you've got a to-do list. What's aragonite? A Markdown editor, which the [readme](https://github.com/voithos-labs/aragonite/blob/main/README.md) explains properly and [aragonite.dev](https://aragonite.dev) demonstrates.

## What it does

The list holds every block the editor's right-click "Insert block" menu offers (your plugins' blocks included), then Heading 1 to 3. Typing narrows it by name or keyword, Enter picks, and Escape closes it and leaves what you typed.

- On an empty line, the block replaces the line. On a line with text, the `/query` goes and the block lands below, except a heading, which turns the line itself into one.
- It opens at the start of a line or after a space, so `and/or` stays text. It never opens in a table cell.
- Two rows take a word after a space: `/code js` opens a code block tagged `js`, and `/table 3x4` makes a table three columns wide and four rows tall, header row included.
- `Ctrl+/` (`Cmd+/` on a Mac) types the `/` for you, and `editor.runCommand('slashCommands.open', 'table')` opens the list already narrowed, which is how a toolbar button or a touch UI gets there.

What lands is plain Markdown, the same as if you'd typed it. The built-in rows, by id (the ids are what `exclude` below takes):

| id               | Row            | Writes                                      |
| ---------------- | -------------- | ------------------------------------------- |
| `bullet`         | Bulleted list  | `- `                                        |
| `numbered`       | Numbered list  | `1. `                                       |
| `todo`           | To-do list     | `- [ ] `                                    |
| `quote`          | Quote          | `> `                                        |
| `divider`        | Divider        | `---`                                       |
| `code`           | Code block     | an empty fence                              |
| `table`          | Table          | two columns, a header row and one empty row |
| `h1`, `h2`, `h3` | Heading 1 to 3 | turns the line into that heading            |

The bundled plugins add `note`, `details`, `math`, `mermaid` and `toc` when they're installed.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-slash-commands
```

Same release, same version number as the editor, and it asks for exactly that one. Upgrade them as a pair.

## Use it

```ts
import { slashCommandsPlugin } from '@voithos-labs/aragonite-slash-commands';

const plugins = [
	slashCommandsPlugin({
		entries: [
			{ id: 'shrug', label: 'Shrug', insert: '¯\\_(ツ)_/¯' },
			{
				id: 'today',
				label: 'Today',
				run: async (editor) => {
					await editor.insertMarkdown(new Date().toDateString());
				}
			}
		],
		exclude: ['divider']
	})
];
```

Pass `plugins` to the editor, built once for the whole app. There are two options, and you can skip both:

- `entries` adds rows of your own, listed after the built-in ones. Each has an `id` and a `label` (and, if you like, an `icon` and `keywords`), plus exactly one of `insert` (Markdown to drop in) or `run` (a function). A row with both or neither makes the factory throw (in one editor's `{ plugin, options }` entry, the editor reports it on its `error` event instead). Reuse a built-in id and your row replaces that built-in one.
- `run` is handed an `editor` to write through (`insertMarkdown`, as above), plus the word typed after a space if the row sets `takesArgument: true`. It can be async. If it waits on something (a picker, a fetch), keep writing through that same `editor`. It quietly writes nothing once the app has loaded another note, so a late answer can't land in the wrong document.
- `exclude` hides built-in rows by id.

What you pass the factory is every editor's default. An editor's own `{ plugin, options }` entry swaps out only the fields it names, so `{ exclude: ['table'] }` still keeps the factory's `entries`, and `{ entries: [] }` is how one editor drops them.

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) has the other bundled plugins, and the plugin API reference's [section on insert menus](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-api.md#insert-catalogue) is how a plugin's own block gets into this list (and takes a word after a space, the way `/table 3x4` does).

## License

Free software, released under [MPL-2.0](./LICENSE) like the editor itself: use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change this plugin's own files, you share those changes under the same license.
