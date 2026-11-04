# @voithos-labs/aragonite-emoji

Emoji shortcodes plugin for [aragonite](https://github.com/voithos-labs/aragonite).

## What it reads

The `:name:` shortcodes GitHub reads:

```markdown
Shipped it :rocket: and nothing caught fire :tada:
```

Note:

- The names are GitHub's own list (gemoji), about 1,900 counting aliases, so `:+1:` and `:thumbsup:` are both 👍.
- They're lowercase, like on GitHub: `:Rocket:` stays text, and so does a name the list doesn't have.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-emoji
```

Btw, the plugin's version should match the editor's version.

## Use it

```ts
import { emojiPlugin } from '@voithos-labs/aragonite-emoji';

const plugins = [emojiPlugin()];
```

Hand `plugins` to the editor, and build the array once for the whole app, not once per editor. No options and no stylesheet. Two small things:

- A glyph acts like one character: Backspace takes out the whole `:rocket:`, and the arrow keys step over it.
- Building a picker? `EMOJI_TABLE` is exported too, a `Map` from shortcode to glyph (`EMOJI_TABLE.get('tada')` is `'🎉'`).

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) lists the first party plugins, and the plugin guide's [inline kinds](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/inline-kinds.md) page walks through this one's recipe, for syntax of your own that lives mid-sentence.

## License

Aragonite and its first party plugins are free software, released under [MPL-2.0](./LICENSE): use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change the lib/plugin's files, you share those changes under the same license.

The shortcode list is generated from GitHub's gemoji, which is MIT-licensed; its notice is in [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
