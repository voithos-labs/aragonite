# @voithos-labs/aragonite-highlight-occurrences

Word highlighting plugin for [aragonite](https://github.com/voithos-labs/aragonite).

## What it does

Put the caret on a word and every place that word appears lights up, like in a code editor. The highlights hide while you type and come back when you stop.

Note:

- It matches whole words, exactly (`rock` doesn't light up `Rock` or `rocks`).
- Code blocks and HTML blocks are skipped.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-highlight-occurrences
```

Btw, the plugin's version should match the editor's version.

## Use it

```ts
import { highlightOccurrencesPlugin } from '@voithos-labs/aragonite-highlight-occurrences';

const plugins = [highlightOccurrencesPlugin()];
```

Hand `plugins` to the editor, and build the array once for the whole app, not once per editor. Then give the highlight a color. Each match gets a see-through box with the classes `decoration-overlay hl-occurrence`:

```css
.decoration-overlay.hl-occurrence {
	background: rgba(250, 204, 21, 0.18);
}
```

Prob put it in a global stylesheet; skip it and the plugin still runs, you just won't see the highlights.

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) lists the first party plugins, and the plugin guide's [decorations](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/decorations.md) page builds this same idea step by step, if you want to paint something of your own over the text.

## License

Aragonite and its first party plugins are free software, released under [MPL-2.0](./LICENSE): use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change the lib/plugin's files, you share those changes under the same license.
