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

// Every bundled-tier plugin now ships in-package (aragonite/plugins/*), so the
// consumer imports those subpaths directly. Only callout stays a synced source: it
// is the external *authoring* validator — proof that a plugin written against the
// public barrels compiles and runs from outside the repo — not a distribution
// channel for shipped plugins.
const MANIFEST = {
	callout: ['callout-kind.ts', 'register.ts', 'CalloutBlock.svelte']
};

// Quote-agnostic on purpose. Prettier keeps this repo on single quotes, but the
// gate must not depend on a formatter to be correct: a double-quoted `"$lib"`
// carries no `$lib/`, so the deep-import scan below would not catch it either, and
// it would reach the consumer as an unresolvable specifier.
const BARREL_SPECIFIER = /(['"`])\$lib(\/plugin)?\1/g;

const rewritten = [];
const offenders = [];
for (const [plugin, files] of Object.entries(MANIFEST)) {
	for (const file of files) {
		const text = readFileSync(join(SRC, plugin, file), 'utf8').replace(
			BARREL_SPECIFIER,
			(_match, quote, subpath) => `${quote}aragonite${subpath ?? ''}${quote}`
		);
		for (const line of text.split('\n')) {
			if (line.includes('$lib/')) offenders.push(`${plugin}/${file}: ${line.trim()}`);
		}
		rewritten.push({ plugin, file, text });
	}
}

if (offenders.length) {
	console.error(
		'sync-consumer-plugins: deep $lib imports survive the rewrite — these files reach past the public barrels:\n  ' +
			offenders.join('\n  ')
	);
	process.exit(1);
}

// Nothing is written, and the previous output is not cleared, until the gate has
// passed over every file: a failed run used to leave a rewritten tree on disk for
// a later build to consume as though it had been checked.
rmSync(OUT, { recursive: true, force: true });
for (const { plugin, file, text } of rewritten) {
	mkdirSync(join(OUT, plugin), { recursive: true });
	writeFileSync(join(OUT, plugin, file), text);
}
console.log('sync-consumer-plugins: OK');
