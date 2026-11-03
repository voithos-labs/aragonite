# @voithos-labs/aragonite-admonitions

Callouts for [aragonite](https://github.com/voithos-labs/aragonite). Write `:::warning Mind the gap`, close it with `:::` a few lines down, and everything in between sits in a box with an icon and a title. GitHub's own `> [!NOTE]` alerts get the same box. What's aragonite? A Markdown editor; the [readme](https://github.com/voithos-labs/aragonite/blob/main/README.md) tells the story, and [aragonite.dev](https://aragonite.dev) lets you poke at it.

## What it reads

Two spellings of the same idea:

```markdown
:::note Heads up
The body is ordinary Markdown: **bold**, lists, code, the lot.
:::

> [!TIP]
> The GitHub form. It stays a GitHub alert in the file, too.
```

There are five types, the same five GitHub has: `note`, `tip`, `important`, `warning` and `caution`. Whatever follows the name on the opening line is the title, and a box without one shows its type's name instead. To put one box inside another, give the outer one a longer fence (`::::note` around a `:::tip`).

Both stay plain Markdown in the file. Only the alert form renders on GitHub, though; to GitHub, `:::note` is just text.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-admonitions
```

It asks for exactly the editor's version (the two release together), so upgrade them at the same time.

## Use it

```ts
import { admonitionsPlugin } from '@voithos-labs/aragonite-admonitions';

const plugins = [admonitionsPlugin()];
```

Hand `plugins` to the editor, and build the array once for the whole app, not once per editor. A few things worth knowing:

- On React, Vue or plain JS, the boxes bring a stylesheet of their own: import `@voithos-labs/aragonite-admonitions/style.css` beside the editor's.
- `Ctrl+7` (`Cmd+7` on a Mac) inside a `:::` box switches it to the next type, through note, tip, important, warning and caution, then back to note. It rewrites the name on the opening line as one undo step.
- Pass `admonitionsPlugin({ convertAlertsOnPaste: true })` and a pasted GitHub alert turns into a `:::` box instead of staying a `> [!NOTE]`. `convertAlertsOnPaste` is off by default.
- Got a whole file of alerts you'd rather have as `:::` boxes? `convertGithubAlertsInDocument` rewrites the top-level ones and leaves code blocks alone (an alert inside a quote or a list stays as it is):

  ```ts
  import { convertGithubAlertsInDocument } from '@voithos-labs/aragonite-admonitions';

  convertGithubAlertsInDocument('> [!TIP]\n> Hydrate.\n');
  // { converted: ':::tip\nHydrate.\n:::\n', changed: true }
  ```

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) has every bundled plugin side by side, and [directives.md](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/directives.md) has the whole `:::` grammar (nesting rules, what a name may contain), for when you want a `:::name` box of your own.

## License

Free software, released under [MPL-2.0](./LICENSE) like the editor itself: use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change this plugin's own files, you share those changes under the same license.
