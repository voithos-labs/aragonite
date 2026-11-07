# @voithos-labs/aragonite-details

Collapsible sections plugin for [aragonite](https://github.com/voithos-labs/aragonite).

## What it reads

```markdown
<details>
<summary>Spoilers</summary>

The butler did it.

</details>
```

Note:

- The body is ordinary Markdown, and `<details open>` starts the section open.
- `<details>` and `</details>` each go alone on their line, with the `<summary>…</summary>` line right after the opener. Anything else (a class on the tag, a summary over two lines, no closing tag) stays a plain HTML block.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-details
```

Btw, the plugin's version should match the editor's version.

## Use it

```ts
import { detailsPlugin } from '@voithos-labs/aragonite-details';

const plugins = [detailsPlugin()];
```

Hand `plugins` to the editor, and build the array once for the whole app, not once per editor. No options. A few things worth knowing:

- On React, Vue or plain JS, the sections bring a stylesheet of their own: import `@voithos-labs/aragonite-details/style.css` beside the editor's.
- Opening or closing a section while you edit adds or drops the `open` on the tag, so the file remembers how you left it.
- `Enter` in the summary moves you into the body.

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) lists the first party plugins, and the plugin guide's [container walkthrough](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/container-walkthrough.md) builds a block that holds other blocks from scratch, collapse toggle included, if you'd rather write your own.

## License

Aragonite and its first party plugins are free software, released under [MPL-2.0](./LICENSE): use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change the lib/plugin's files, you share those changes under the same license.
