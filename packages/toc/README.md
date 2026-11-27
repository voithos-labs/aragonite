# @voithos-labs/aragonite-toc

Table of contents plugin for [aragonite](https://github.com/voithos-labs/aragonite).

## What it reads

```markdown
# Field notes

[[toc]]

## Rocks I have licked

## Rocks I regret licking
```

`[[toc]]` lists every heading in the document and keeps up as you write.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-toc
```

Btw, the plugin's version should match the editor's version.

## Use it

```ts
import { toc } from '@voithos-labs/aragonite-toc';

const plugins = [toc];
```

Hand `plugins` to the editor. Editors that want the same options can share one array; an editor that wants others gets its own. A few things worth knowing:

- On React, Vue or plain JS, the list brings a stylesheet of its own: import `@voithos-labs/aragonite-toc/style.css` beside the editor's.
- Click an entry (or press Enter on it) to jump to its heading. To edit the `[[toc]]` line itself, click the block anywhere but an entry.
- `maxDepth` (1 to 6, default 6) is the deepest heading level listed, in the editor whose `plugins` holds it: `[toc({ maxDepth: 3 })]`.

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) lists the first party plugins, and the plugin guide's page on [reading the document above your block](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/reading-the-document.md) builds a block like this one.

## License

Aragonite and its first party plugins are free software, released under [MPL-2.0](./LICENSE): use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change the lib/plugin's files, you share those changes under the same license.
