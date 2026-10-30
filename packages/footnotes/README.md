# @voithos-labs/aragonite-footnotes

A plugin for [aragonite](https://github.com/voithos-labs/aragonite), the cute markdown editor lib: GFM footnotes: `[^label]` references as numbers, and their definitions as editable blocks.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-footnotes
```

It ships at the same version as the editor and asks for exactly that version, so bump them together.

## Use it

```ts
import { footnotesPlugin } from '@voithos-labs/aragonite-footnotes';

const plugins = [footnotesPlugin()];
```

Pass `plugins` to the editor, and build the array once for the whole app. Not on Svelte (React, Vue, plain JS)? Import `@voithos-labs/aragonite-footnotes/style.css` next to the editor's `style.css`.

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) has the options.

## License

[MPL-2.0](./LICENSE), the same as the editor.
