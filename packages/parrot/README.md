# @voithos-labs/aragonite-parrot

A party parrot for [aragonite](https://github.com/voithos-labs/aragonite). Start a line with `%%parrot` and an ASCII parrot dances there, cycling through colors, with whatever follows the marker as its caption. It's the same bird `curl parrot.live` serves, and it does nothing useful whatsoever. Aragonite itself is a Markdown editor; its [readme](https://github.com/voithos-labs/aragonite/blob/main/README.md) says more, and [aragonite.dev](https://aragonite.dev) lets you try it.

## What it reads

```markdown
%%parrot ship it
```

One line that starts with `%%parrot`. The rest of the line, trimmed, is the caption. Without the plugin it's an ordinary paragraph.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-parrot
```

The parrot and the editor share a version number, and the parrot insists on it, so update them together.

## Use it

```ts
import { parrotPlugin } from '@voithos-labs/aragonite-parrot';

const plugins = [parrotPlugin()];
```

Pass `plugins` to the editor (one array for the app), and if you're not on Svelte, import `@voithos-labs/aragonite-parrot/style.css` too, since the dance itself lives in that file. Not much else to it:

- Click the parrot or its caption to edit the line. It goes back to dancing when the caret leaves, and the whole visit is one undo step.
- Anyone whose system asks for reduced motion gets a parrot that holds still.

## More

The plugin guide's [first fifteen minutes](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide.md#the-first-fifteen-minutes) builds this exact parrot from nothing, and [parrot-frames.md](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/parrot-frames.md) has all ten frames. The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) lists the other bundled plugins.

## License

Free software, released under [MPL-2.0](./LICENSE) like the editor itself: use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change this plugin's own files, you share those changes under the same license.

The ten frames come from terminal-parrot, which is MIT-licensed; its notice is in [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
