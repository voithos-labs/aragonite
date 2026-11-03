# @voithos-labs/aragonite-highlight-occurrences

Put the caret on a word and every place that word appears lights up, the way a code editor does it. That's this plugin, for [aragonite](https://github.com/voithos-labs/aragonite) (a Markdown editor: the [readme](https://github.com/voithos-labs/aragonite/blob/main/README.md) has the details, [aragonite.dev](https://aragonite.dev) the demo).

## What it does

Move the caret onto `rock` and every `rock` in the document gets highlighted, the one you're on included. Move to another word and the highlights follow; land on a space and they go away.

- It matches whole words, exactly: `rock` doesn't light up `Rock` or `rocks`. A word is letters, digits and underscores.
- Code blocks and HTML blocks are skipped, both as places to look and as words to look for.
- The highlights hide while you type and come back a quarter second after you stop, so nothing flickers under your caret mid-sentence.

The highlight is painted over the text, so nothing is ever written to the file.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-highlight-occurrences
```

Its version always matches the editor's exactly, so the two move together.

## Use it

```ts
import { highlightOccurrencesPlugin } from '@voithos-labs/aragonite-highlight-occurrences';

const plugins = [highlightOccurrencesPlugin()];
```

Pass `plugins` to the editor, built once for the app. Then give the highlight a color, because the plugin doesn't pick one. It lays a box over each match with the classes `decoration-overlay hl-occurrence`, and that box is see-through until something gives it a background. The demo uses a translucent yellow:

```css
.decoration-overlay.hl-occurrence {
	background: rgba(250, 204, 21, 0.18);
}
```

Put it in a global stylesheet (inside a Svelte component's `<style>`, wrap the selector in `:global(...)`). Forget it and the plugin still works perfectly; you just can't tell.

The factory takes one option, `onScan`, a callback that fires each time the plugin re-reads the document. It's there for tests, and you can safely ignore it.

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) has the other bundled plugins, and the plugin guide's [decorations](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/decorations.md) page builds this same idea step by step, if you want to paint something of your own over the text.

## License

Free software, released under [MPL-2.0](./LICENSE) like the editor itself: use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change this plugin's own files, you share those changes under the same license.
