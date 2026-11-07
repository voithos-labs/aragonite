# @voithos-labs/aragonite-admonitions

Callouts plugin for [aragonite](https://github.com/voithos-labs/aragonite).

## What it reads

Two syntaxes you can use:

```markdown
:::note Heads up
The body is ordinary Markdown: **bold**, lists, code, the lot.
:::

> [!TIP]
> The GitHub form. It stays a GitHub alert in the file, too.
```

Both syntax support five types: `note`, `tip`, `important`, `warning` and `caution`, similar to github.

Note:

- Whatever follows the name on the opening line is the title
- To nest boxes using syntax 1, give the outer one a longer fence (`::::note` around a `:::tip`).

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-admonitions
```

Btw, the plugin's version should match the editor's version.

## Use it

```ts
import { admonitionsPlugin } from '@voithos-labs/aragonite-admonitions';

const plugins = [admonitionsPlugin()];
```

Hand `plugins` to the editor, and build the array once for the whole app, not once per editor. A few things worth knowing:

- On React, Vue or plain JS, the boxes bring a stylesheet of their own: import `@voithos-labs/aragonite-admonitions/style.css` beside the editor's.
- `Ctrl+7` (`Cmd+7` on a Mac) inside a `:::` box switches it to the next type, through note, tip, important, warning and caution, then back to note.
- Pass `admonitionsPlugin({ convertAlertsOnPaste: true })` and a pasted GitHub alert turns into a `:::` box instead of staying a `> [!NOTE]`. This behavior is opt in.
- Got a whole file of alerts you'd rather have as `:::` boxes? `convertGithubAlertsInDocument` does that for you.

  ```ts
  import { convertGithubAlertsInDocument } from '@voithos-labs/aragonite-admonitions';

  convertGithubAlertsInDocument('> [!TIP]\n> Hydrate.\n');
  // { converted: ':::tip\nHydrate.\n:::\n', changed: true }
  ```

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) lists the first party plugins, and [directives.md](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/directives.md) describes the whole `:::` grammar (nesting rules, what a name may contain), for when you want a `:::name` box of your own.

## License

Aragonite and its first party plugins are free software, released under [MPL-2.0](./LICENSE): use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change the lib/plugin's files, you share those changes under the same license.
