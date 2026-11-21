# @voithos-labs/aragonite-highlight

Code highlighting plugin for [aragonite](https://github.com/voithos-labs/aragonite).

## What it reads

Any code fence that names a language highlight.js knows, which is a lot of them:

````markdown
```rust
fn main() {
    println!("hi");
}
```
````

The editor itself ships no grammars, so without this plugin every fence paints plain.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-highlight highlight.js
```

Btw, the plugin's version should match the editor's version.

## Use it

```ts
import { highlight } from '@voithos-labs/aragonite-highlight';
import { highlightJs } from '@voithos-labs/aragonite-highlight/renderer';

const plugins = [highlight({ renderer: highlightJs() })];
```

Hand `plugins` to the editor, and build the array once for the whole app, not once per editor. A few things worth knowing:

- Eight grammars load with the page: JavaScript, TypeScript, JSON, shell, Python, HTML/XML, CSS and Markdown. Every other one is a chunk of its own, fetched the first time a fence names it. The fence paints plain until it lands, then highlights, and the caret stays put.
- Your bundler splits those chunks out of highlight.js for you; serve them with the rest of your build.
- The colors come from the editor's theme, so there's no stylesheet to import.
- A grammar highlight.js doesn't ship goes in `languages`, by name, asked before the bundled ones: `highlightJs({ languages: { mylang: { load: () => import('./mylang'), aliases: ['mlg'] } } })`. A grammar you already hold can go in directly, without the loader.
- `resolver` replaces the bundled list whole, if you'd rather decide every name yourself. `defaultResolver` is the one it replaces, and `listLanguages(options)` says what the code block's picker will show.

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#bundled-plugins) lists the first party plugins, and the [plugin guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide.md) is where to go if you'd rather write your own.

## License

Aragonite and its first party plugins are free software, released under [MPL-2.0](./LICENSE): use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change the lib/plugin's files, you share those changes under the same license.
