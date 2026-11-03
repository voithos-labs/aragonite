# @voithos-labs/aragonite-toc

A live table of contents for [aragonite](https://github.com/voithos-labs/aragonite). Put `[[toc]]` on a line of its own and it lists every heading in the document, kept up to date as you write; click an entry and you're there. What's aragonite? The [readme](https://github.com/voithos-labs/aragonite/blob/main/README.md) is the long answer, and [aragonite.dev](https://aragonite.dev) the hands-on one.

## What it reads

```markdown
# Field notes

[[toc]]

## Rocks I have licked

## Rocks I regret licking
```

Just the `[[toc]]` line, exactly that, with no indent and nothing after it. The list itself is drawn, never written, so the file only ever holds that one line (and without the plugin, it's a paragraph that says `[[toc]]`).

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-toc
```

It shares the editor's version number and asks for exactly that one, so when the editor moves, this moves with it.

## Use it

```ts
import { tocPlugin } from '@voithos-labs/aragonite-toc';

const plugins = [tocPlugin()];
```

Hand the editor `plugins`, built once and shared rather than rebuilt per editor. One option, and a couple of habits worth knowing:

- If your app isn't Svelte, import `@voithos-labs/aragonite-toc/style.css` alongside the editor's own stylesheet.
- `maxDepth` (1 to 6, default 6) is the deepest heading level listed. `tocPlugin({ maxDepth: 3 })` sets it for every editor, and a `{ plugin, options }` entry in one editor's `plugins` overrides it there:

  ```ts
  import { tocPlugin, type TocOptions } from '@voithos-labs/aragonite-toc';

  const plugins = [{ plugin: tocPlugin(), options: { maxDepth: 3 } satisfies TocOptions }];
  ```

  The `satisfies` keeps a typo a compile error, since the editor types `options` as `unknown`. At runtime, an entry's `maxDepth` that isn't a whole number from 1 to 6 falls back to the factory's.

- Entries are indented by level, and a heading inside a quote, a list or a callout gets listed too. Labels lose their formatting, so `## **Bold** move` lists as "Bold move".
- Clicking an entry, or Enter on it from the keyboard, jumps to the heading, in every mode, reading included. To edit the `[[toc]]` line itself, click the block anywhere but an entry.

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) has the other bundled plugins, and the plugin guide's page on [reading the document above your block](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/reading-the-document.md) builds a block like this one.

## License

Free software, released under [MPL-2.0](./LICENSE) like the editor itself: use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change this plugin's own files, you share those changes under the same license.
