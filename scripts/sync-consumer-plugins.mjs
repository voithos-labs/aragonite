// Sync the dogfood plugin sources into examples/consumer with imports rewritten
// to the published package. Fails loud on any $lib deep import that survives —
// a dogfood reach-in past the public barrels must break this gate, not ride it.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src/routes/test/plugins';
const OUT = 'examples/consumer/src/plugins';

// BlockMath.svelte + latex/register.ts are deliberately absent: block math is
// dogfood for the post-1.0 editable-leaf tier and cannot cross the boundary.
const MANIFEST = {
	callout: ['callout-kind.ts', 'register.ts', 'CalloutBlock.svelte'],
	details: ['details-kind.ts', 'register.ts', 'DetailsBlock.svelte'],
	latex: ['latex-kind.ts', 'math-renderer.ts'],
	// index.ts crosses too: registering the component is behind installAdmonitions(),
	// so the consumer route imports the barrel, not register.ts alone.
	admonitions: [
		'kinds.ts',
		'register.ts',
		'AdmonitionBlock.svelte',
		'gh-alert.ts',
		'convert-document.ts',
		'index.ts'
	]
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
