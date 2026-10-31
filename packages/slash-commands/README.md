# @voithos-labs/aragonite-slash-commands

A plugin for [aragonite](https://github.com/voithos-labs/aragonite), the cute markdown editor lib: a `/` menu at the start of a line, for inserting blocks and turning the line into a heading.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-slash-commands
```

It ships at the same version as the editor and asks for exactly that version, so bump them together.

## Use it

```ts
import { slashCommandsPlugin } from '@voithos-labs/aragonite-slash-commands';

const plugins = [slashCommandsPlugin()];
```

Pass `plugins` to the editor, and build the array once for the whole app.

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) has the options.

## License

[MPL-2.0](./LICENSE), the same as the editor.
