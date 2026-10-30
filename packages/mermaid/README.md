# @voithos-labs/aragonite-mermaid

A plugin for [aragonite](https://github.com/voithos-labs/aragonite), the cute markdown editor lib: a ` ```mermaid ` fence drawn as a diagram.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-mermaid mermaid
```

It ships at the same version as the editor and asks for exactly that version, so bump them together. `mermaid` is only needed if you pass the renderer; without it, each diagram shows its source.

## Use it

```ts
import { mermaidPlugin } from '@voithos-labs/aragonite-mermaid';
import { mermaidRenderer } from '@voithos-labs/aragonite-mermaid/renderer';

const plugins = [mermaidPlugin({ renderer: mermaidRenderer })];
```

Pass `plugins` to the editor, and build the array once for the whole app. Not on Svelte (React, Vue, plain JS)? Import `@voithos-labs/aragonite-mermaid/style.css` next to the editor's `style.css`.

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) has the options.

## License

[MPL-2.0](./LICENSE), the same as the editor.
