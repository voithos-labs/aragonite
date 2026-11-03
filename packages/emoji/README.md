# @voithos-labs/aragonite-emoji

GitHub's `:shortcode:` emoji for [aragonite](https://github.com/voithos-labs/aragonite). Type `:rocket:` and you see 🚀, while the file keeps saying `:rocket:`. In case you're wondering what aragonite is, the [readme](https://github.com/voithos-labs/aragonite/blob/main/README.md) explains and [aragonite.dev](https://aragonite.dev) shows.

## What it reads

```markdown
Shipped it :rocket: and nothing caught fire :tada:
```

The names come from gemoji, GitHub's own emoji list: about 1,900 of them, counting aliases (`:+1:` and `:thumbsup:` are the same 👍). Like on GitHub they're lowercase, so `:Rocket:` stays text, and so does a name the list doesn't have, a time like `10:30`, or a URL.

Without the plugin, `:rocket:` is a word with colons around it, which is all the file ever held anyway.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-emoji
```

Keep the two on the same version. The plugin asks for the editor's exact one, and npm won't install a mismatch.

## Use it

```ts
import { emojiPlugin } from '@voithos-labs/aragonite-emoji';

const plugins = [emojiPlugin()];
```

No options and no stylesheet. Pass `plugins` to the editor, built once for the app, and that's the whole setup. Two small things:

- A glyph behaves like one character. Backspace takes out the whole `:rocket:` at once, and the arrow keys step over it.
- Building a picker? `EMOJI_TABLE` is exported too, a `Map` from shortcode to glyph (`EMOJI_TABLE.get('tada')` is `'🎉'`).

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) covers the other bundled plugins, and the plugin guide's [inline kinds](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/inline-kinds.md) page walks through this one's recipe, for syntax of your own that lives mid-sentence.

## License

Free software, released under [MPL-2.0](./LICENSE) like the editor itself: use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change this plugin's own files, you share those changes under the same license.

The shortcode list is generated from GitHub's gemoji, which is MIT-licensed; its notice is in [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
