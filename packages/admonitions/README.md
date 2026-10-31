# @voithos-labs/aragonite-admonitions

A plugin for [aragonite](https://github.com/voithos-labs/aragonite), the cute markdown editor lib: `:::note` directive callouts and GitHub alerts (`> [!NOTE]`), drawn as styled boxes.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-admonitions
```

It ships at the same version as the editor and asks for exactly that version, so bump them together.

## Use it

```ts
import { admonitionsPlugin } from '@voithos-labs/aragonite-admonitions';

const plugins = [admonitionsPlugin()];
```

Pass `plugins` to the editor, and build the array once for the whole app. Not on Svelte (React, Vue, plain JS)? Import `@voithos-labs/aragonite-admonitions/style.css` next to the editor's `style.css`.

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) has the options.

## License

[MPL-2.0](./LICENSE), the same as the editor.
