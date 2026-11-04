# @voithos-labs/aragonite-latex

Math plugin for [aragonite](https://github.com/voithos-labs/aragonite).

## What it reads

All three ways GitHub writes math:

````markdown
Inline, between single dollars: $a^2 + b^2 = c^2$.

$$
\int_0^1 x^2 \, dx = \tfrac{1}{3}
$$

```math
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
```
````

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-latex katex
```

Btw, the plugin's version should match the editor's version. `katex` (0.17 to 0.19) is optional and only there for the renderer below; skip both and each formula just shows its source.

## Use it

```ts
import { latexPlugin } from '@voithos-labs/aragonite-latex';
import { katexRenderer } from '@voithos-labs/aragonite-latex/renderer';

const plugins = [latexPlugin({ renderer: katexRenderer })];
```

Hand `plugins` to the editor, and build the array once for the whole app, not once per editor. A few things worth knowing:

- On React, Vue or plain JS, the formulas bring a stylesheet of their own: import `@voithos-labs/aragonite-latex/style.css` beside the editor's. The renderer brings KaTeX's stylesheet with it.
- `blockLayout` is how a math block opens while you edit it: `'split'` (the preview beside the source, the default), `'stacked'` (below it, nicer for long equations) or `'source'` (no preview at all). The block's own toggle cycles through them, and `{ plugin, options: { blockLayout } }` picks one per editor.
- Rather not use KaTeX? `renderer` is any function from `(source, { display, theme })` to `{ dom, error? }`, so MathJax or your own thing fits.

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) lists the first party plugins, and the [plugin guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide.md) is where to go if you'd rather write your own.

## License

Aragonite and its first party plugins are free software, released under [MPL-2.0](./LICENSE): use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change the lib/plugin's files, you share those changes under the same license.
