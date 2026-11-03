# @voithos-labs/aragonite-latex

Math for [aragonite](https://github.com/voithos-labs/aragonite). Type `$e^{i\pi} + 1 = 0$` and it turns into a formula the moment your caret leaves it; click back in and you're editing the source again. What's aragonite? The [readme](https://github.com/voithos-labs/aragonite/blob/main/README.md) has the short-ish version, and [aragonite.dev](https://aragonite.dev) has one you can type in.

## What it reads

All three ways GitHub writes math, so a file you write here renders the same over there:

````markdown
Inline, between single dollars: $a^2 + b^2 = c^2$.

$$
\int_0^1 x^2 \, dx = \tfrac{1}{3}
$$

```math
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
```
````

The file stays exactly what you typed. The plugin only changes how it's drawn.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-latex katex
```

It ships at the same version as the editor and asks for exactly that version, so bump them together. `katex` is only there for the renderer below; skip both and each formula just shows its source.

## Use it

```ts
import { latexPlugin } from '@voithos-labs/aragonite-latex';
import { katexRenderer } from '@voithos-labs/aragonite-latex/renderer';

const plugins = [latexPlugin({ renderer: katexRenderer })];
```

Pass `plugins` to the editor, and build the array once for the whole app rather than per editor. Some details you might care about:

- Not on Svelte (React, Vue, plain JS)? Import `@voithos-labs/aragonite-latex/style.css` next to the editor's `style.css`. The renderer brings KaTeX's own stylesheet with it.
- `blockLayout` is how a `$$` block opens while you edit it: `'split'` (the preview beside the source, the default), `'stacked'` (below it, nicer for long equations) or `'source'` (no preview at all). The block's own toggle cycles through them, and `{ plugin, options: { blockLayout } }` picks one per editor.
- Prices and shell variables are safe: `$5 and $10` or `$HOME and $PATH` stay plain text, the way they do on GitHub.
- Rather not use KaTeX? `renderer` is any function from `(source, { display, theme })` to `{ dom, error? }`, so MathJax or your own thing fits.

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) has every bundled plugin's options in one table, and the [plugin guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide.md) is where to go if you'd rather write your own.

## License

Free software, released under [MPL-2.0](./LICENSE) like the editor itself: use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change this plugin's own files, you share those changes under the same license.
