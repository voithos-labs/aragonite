# @voithos-labs/aragonite-parrot

Party parrot plugin for [aragonite](https://github.com/voithos-labs/aragonite).

## What it reads

```markdown
%%parrot ship it
```

A line that starts with `%%parrot` turns into an ASCII parrot dancing in colors, and the rest of the line is its caption. It does nothing useful whatsoever.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-parrot
```

Btw, the plugin's version should match the editor's version.

## Use it

```ts
import { parrotPlugin } from '@voithos-labs/aragonite-parrot';

const plugins = [parrotPlugin()];
```

Hand `plugins` to the editor, and build the array once for the whole app, not once per editor. No options. Not much else to it:

- On React, Vue or plain JS, import `@voithos-labs/aragonite-parrot/style.css` beside the editor's stylesheet. The dance lives in that file.
- Click the parrot or its caption to edit the line. It goes back to dancing when the caret leaves.
- If your system asks for reduced motion, the parrot holds still.

## More

The plugin guide's [first fifteen minutes](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide.md#the-first-fifteen-minutes) builds this exact parrot from nothing, and [parrot-frames.md](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/parrot-frames.md) has all ten frames. The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) lists the first party plugins.

## License

Aragonite and its first party plugins are free software, released under [MPL-2.0](./LICENSE): use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change the lib/plugin's files, you share those changes under the same license.

The ten frames come from terminal-parrot, which is MIT-licensed; its notice is in [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
