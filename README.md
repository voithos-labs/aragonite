# aragonite

A CST-based block editor for GFM Markdown, built with SvelteKit + TypeScript. Raw Markdown is the source of truth — the editor parses it into a lossless concrete syntax tree, renders styled blocks with dimmed syntax markers, and round-trips byte-for-byte (`serialize(parse(source)) === source`).

Extracted from [limestone](https://github.com/DanielZFLiu/limestone), where it was developed as an embeddable module; aragonite is its standalone home. The library lives in `src/lib/`; `src/routes/test/editor` is a demo/dev harness.

## Use it

```svelte
<script>
	import { Editor } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';

	let editor;
</script>

<Editor bind:this={editor} source={'# Hello\n\nStart typing.'} theme="dark" />
<button onclick={() => save(editor.getSource())}>Save</button>
```

`source` seeds the document at mount; `editor.getSource()` pulls the current Markdown back out. The full public surface is the barrel at `src/lib/index.ts`.

## Develop

Prerequisites: [Node.js](https://nodejs.org/) (LTS).

```bash
npm install
```

| Command               | Purpose                                       |
| --------------------- | --------------------------------------------- |
| `npm run dev`         | Demo app at `/test/editor`                    |
| `npm test`            | Full suite — unit (Vitest) + E2E (Playwright) |
| `npm run test:editor` | Unit tests                                    |
| `npm run test:e2e`    | E2E tests                                     |
| `npm run check`       | Type-check (svelte-check)                     |
| `npm run format`      | Prettier write                                |

See `package.json` for per-area test scripts.

## Docs

- [`docs/design/editor/editor.md`](docs/design/editor/editor.md) — editor design spec
- [`docs/editor/consumer-guide.md`](docs/editor/consumer-guide.md) — public API, theming, props, events
- [`docs/editor/adding-a-block.md`](docs/editor/adding-a-block.md) — adding a new block type
- [`docs/roadmap.md`](docs/roadmap.md) — forward-looking plan
- [`docs/changelog.md`](docs/changelog.md) — shipped version history

## License

MIT.
