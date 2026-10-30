# @voithos-labs/aragonite-details

A plugin for [aragonite](https://github.com/voithos-labs/aragonite), the cute markdown editor lib: a `<details>` HTML block as a collapsible section you can edit, summary included.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-details
```

It ships at the same version as the editor and asks for exactly that version, so bump them together.

## Use it

```ts
import { detailsPlugin } from '@voithos-labs/aragonite-details';

const plugins = [detailsPlugin()];
```

Pass `plugins` to the editor, and build the array once for the whole app. Not on Svelte (React, Vue, plain JS)? Import `@voithos-labs/aragonite-details/style.css` next to the editor's `style.css`.

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) has the options.

## License

[MPL-2.0](./LICENSE), the same as the editor.
