# @voithos-labs/aragonite-emoji

A plugin for [aragonite](https://github.com/voithos-labs/aragonite), the cute markdown editor lib: GitHub `:shortcode:` emoji, drawn as the glyph.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-emoji
```

It ships at the same version as the editor and asks for exactly that version, so bump them together.

## Use it

```ts
import { emojiPlugin } from '@voithos-labs/aragonite-emoji';

const plugins = [emojiPlugin()];
```

Pass `plugins` to the editor, and build the array once for the whole app.

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) has the options.

## License

[MPL-2.0](./LICENSE), the same as the editor.
