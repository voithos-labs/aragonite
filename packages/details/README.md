# @voithos-labs/aragonite-details

Collapsible sections for [aragonite](https://github.com/voithos-labs/aragonite). The `<details>` block you'd write for GitHub becomes a section that folds open and shut, with its summary and its body both editable right where they are. Never heard of aragonite? The [readme](https://github.com/voithos-labs/aragonite/blob/main/README.md) covers what it is, and [aragonite.dev](https://aragonite.dev) has a demo you can type in.

## What it reads

```markdown
<details>
<summary>Spoilers</summary>

The butler did it.

</details>
```

The plugin takes this one shape: `<details>` (or `<details open>`) alone on its line, `<summary>…</summary>` on the very next one, then the body, which is ordinary Markdown, then `</details>` alone on its line. Anything else (a class on the tag, a summary spread over two lines, no closing tag) stays the plain HTML block it always was.

It's HTML in the file either way. Without the plugin it's an HTML block, and GitHub draws it as the same collapsible section.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-details
```

The plugin and the editor release together, and the plugin wants the editor's exact version, so bump both at once.

## Use it

```ts
import { detailsPlugin } from '@voithos-labs/aragonite-details';

const plugins = [detailsPlugin()];
```

No options. Pass `plugins` to the editor, and build the array once for the app rather than per editor. Things that might surprise you:

- Outside Svelte, add `@voithos-labs/aragonite-details/style.css` to the stylesheets you already import for the editor.
- Opening or closing a section while you edit adds or drops the `open` on the tag, as one undo step, so the file remembers how you left it. In reading mode the toggle is only for looking, and the file stays put.
- While you edit, a jump into a closed section (a search match, a table-of-contents entry) opens it first, which writes the `open` the same way.
- `Enter` in the summary moves you into the body.
- Type a stray `<details>` or `</details>` line inside the body and its `<` is saved as `&lt;`, so it can't end the section early. It still shows as `<`, here and on GitHub.

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) has the rest of the bundled plugins, and the plugin guide's [container walkthrough](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/container-walkthrough.md) builds a block that holds other blocks from scratch, collapse toggle included, if you'd rather write your own.

## License

Free software, released under [MPL-2.0](./LICENSE) like the editor itself: use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change this plugin's own files, you share those changes under the same license.
