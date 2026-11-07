# @voithos-labs/aragonite-footnotes

Footnotes plugin for [aragonite](https://github.com/voithos-labs/aragonite).

## What it reads

GitHub's footnote syntax:

```markdown
Aragonite is a carbonate mineral[^rock], named after Aragon[^where].

[^where]: A region of Spain.

[^rock]: A rock, basically.

    A line indented four spaces is still part of the footnote above it.
```

A reference shows as a small superscript number, and its definition is a block you edit like any other.

Note:

- Numbers go by where a footnote is first cited, not where it's defined, so `[^rock]` is 1 and `[^where]` is 2 here.
- A label is anything without a space in it, and a definition can sit anywhere in the document.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-footnotes
```

Btw, the plugin's version should match the editor's version.

## Use it

```ts
import { footnotesPlugin } from '@voithos-labs/aragonite-footnotes';

const plugins = [footnotesPlugin()];
```

Hand `plugins` to the editor, and build the array once for the whole app, not once per editor. No options. A few things worth knowing:

- On React, Vue or plain JS, the footnotes bring a stylesheet of their own: import `@voithos-labs/aragonite-footnotes/style.css` beside the editor's.
- A reference jumps to its definition on the click your editor uses to follow a link: Ctrl+click (Cmd+click on a Mac) while you edit, a plain click in reading mode, and a plain click in live mode too if you set the editor's `linkClick` to `'plain'`. Any other click on a reference opens its `[^label]` for editing.
- The `[^label]` in front of a definition takes you back to the first citation, on the same click.
- In reading mode both are links a keyboard can reach: Tab to one, Enter to follow it.

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) lists the first party plugins, and the plugin guide's [inline kinds](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/inline-kinds.md) page uses this plugin as its worked example, if you're writing syntax of your own that sits mid-paragraph.

## License

Aragonite and its first party plugins are free software, released under [MPL-2.0](./LICENSE): use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change the lib/plugin's files, you share those changes under the same license.
