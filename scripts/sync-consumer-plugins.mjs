// Sync the dogfood plugin sources into examples/consumer with imports rewritten
// to the published package. Fails loud on any $lib deep import that survives —
// a dogfood reach-in past the public barrels must break this gate, not ride it.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Anchor at the repo root, not the cwd, so the consumer's own pre-hooks can run
// this from examples/consumer as well as CI/the smoke running it from the root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src/routes/test/plugins');
const OUT = join(ROOT, 'examples/consumer/src/plugins');

// admonitions + details ship in-package (aragonite/plugins/*), so the consumer
// route imports those subpaths directly — only the not-yet-packaged plugins sync.
const MANIFEST = {
	callout: ['callout-kind.ts', 'register.ts', 'CalloutBlock.svelte'],
	// The whole plugin crosses: MathInline on the component-widget path,
	// BlockMath on the editable-leaf tier (createEditableLeaf). katex is a
	// consumer devDependency.
	latex: [
		'latex-kind.ts',
		'math-renderer.ts',
		'MathInline.svelte',
		'BlockMath.svelte',
		'register.ts'
	],
	// harness-renderer.ts stays repo-side: the renderer is injected, so the
	// consumer supplies its own engine wiring.
	mermaid: ['mermaid-kind.ts', 'mermaid-renderer.ts', 'register.ts', 'MermaidBlock.svelte']
};

rmSync(OUT, { recursive: true, force: true });
const offenders = [];
for (const [plugin, files] of Object.entries(MANIFEST)) {
	mkdirSync(join(OUT, plugin), { recursive: true });
	for (const file of files) {
		let text = readFileSync(join(SRC, plugin, file), 'utf8');
		text = text.replaceAll("'$lib/plugin'", "'aragonite/plugin'");
		text = text.replaceAll("'$lib'", "'aragonite'");
		for (const line of text.split('\n')) {
			if (line.includes('$lib/')) offenders.push(`${plugin}/${file}: ${line.trim()}`);
		}
		writeFileSync(join(OUT, plugin, file), text);
	}
}
if (offenders.length) {
	console.error(
		'sync-consumer-plugins: deep $lib imports survive the rewrite — these files reach past the public barrels:\n  ' +
			offenders.join('\n  ')
	);
	process.exit(1);
}
console.log('sync-consumer-plugins: OK');
