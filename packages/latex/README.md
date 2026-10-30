# @voithos-labs/aragonite-latex

A plugin for [aragonite](https://github.com/voithos-labs/aragonite), the cute markdown editor lib: inline `$…$` math, `$$…$$` blocks and the ` ```math ` fence.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-latex katex
```

It ships at the same version as the editor and asks for exactly that version, so bump them together. `katex` is only needed if you pass the renderer; without it, each formula shows its source.

## Use it

```ts
import { latexPlugin } from '@voithos-labs/aragonite-latex';
import { katexRenderer } from '@voithos-labs/aragonite-latex/renderer';

const plugins = [latexPlugin({ renderer: katexRenderer })];
```

Pass `plugins` to the editor, and build the array once for the whole app. Not on Svelte (React, Vue, plain JS)? Import `@voithos-labs/aragonite-latex/style.css` next to the editor's `style.css`.

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) has the options.

## License

[MPL-2.0](./LICENSE), the same as the editor.
