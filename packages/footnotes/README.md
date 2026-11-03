# @voithos-labs/aragonite-footnotes

GFM footnotes for [aragonite](https://github.com/voithos-labs/aragonite). A `[^1]` in a sentence shows as a small superscript number, and its definition is a block you edit like any other. If aragonite is new to you, the [readme](https://github.com/voithos-labs/aragonite/blob/main/README.md) is the place to start and [aragonite.dev](https://aragonite.dev) the place to type.

## What it reads

```markdown
Aragonite is a carbonate mineral[^rock], named after Aragon[^where].

[^where]: A region of Spain.

[^rock]: A rock, basically.

    A line indented four spaces is still part of the footnote above it.
```

Numbers go by where a footnote is first cited, not where it's defined, so `[^rock]` shows as 1 and `[^where]` as 2 here. A label is anything without a space in it. A definition can sit anywhere in the document, and it stays where you put it.

It's the same footnote syntax GitHub renders, so the file reads fine over there.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-footnotes
```

It releases alongside the editor, version for version, so when you bump one, bump the other.

## Use it

```ts
import { footnotesPlugin } from '@voithos-labs/aragonite-footnotes';

const plugins = [footnotesPlugin()];
```

Pass `plugins` to the editor, one array for the whole app rather than one per editor. There are no options, and the only extra step is outside Svelte, where you import `@voithos-labs/aragonite-footnotes/style.css` with the editor's stylesheets.

How the jumping works:

- A reference jumps to its definition on whichever click your editor uses to follow a link: Ctrl+click (Cmd+click on a Mac) while you edit, a plain click in reading mode, and a plain click in live mode too if you set the editor's `linkClick` to `'plain'`. Any other click on a reference opens its `[^label]` for editing.
- The `[^label]` in front of a definition is the way back, on the same click, and it lands right after the footnote's first citation.
- In reading mode both are links a keyboard can reach: Tab to one, Enter to follow it.

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) lists every bundled plugin, and if you're writing syntax of your own that sits mid-paragraph, the plugin guide's [inline kinds](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/inline-kinds.md) page uses this plugin as its worked reference.

## License

Free software, released under [MPL-2.0](./LICENSE) like the editor itself: use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change this plugin's own files, you share those changes under the same license.
