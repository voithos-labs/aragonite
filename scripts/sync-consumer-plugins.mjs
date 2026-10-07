// Sync the dogfood plugin sources into examples/consumer with imports rewritten to the
// published package. A dogfood reach-in past the public barrels must break this gate.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aliasPath } from './lib-alias.mjs';

// Anchor at the repo root, not the cwd, so the consumer's own pre-hooks can run
// this from examples/consumer as well as CI/the smoke running it from the root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src/routes/test/plugins');
const OUT = join(ROOT, 'examples/consumer/src/plugins');

// Bundled-tier plugins ship in-package, so the consumer imports those subpaths directly. Only
// callout stays a synced source: it is the external *authoring* validator.
const MANIFEST = {
	callout: ['callout-kind.ts', 'register.ts', 'CalloutBlock.svelte']
};

// Quote-agnostic on purpose: the gate must not depend on Prettier to be correct.
const ALIAS_SPECIFIER = /(['"`])(#[^'"`\s]*)\1/g;

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** The package specifier for a library path a published entry point ships, or null. */
function publishedSpecifier(/** @type {string} */ libraryPath) {
	const target = libraryPath.replace(/^src\/lib\//, './dist/');
	for (const [subpath, entry] of Object.entries(pkg.exports)) {
		if (typeof entry === 'object' && entry.default === target) {
			return `${pkg.name}${subpath.slice(1)}`;
		}
	}
	return null;
}

const rewritten = [];
const offenders = [];
for (const [plugin, files] of Object.entries(MANIFEST)) {
	for (const file of files) {
		const text = readFileSync(join(SRC, plugin, file), 'utf8').replace(
			ALIAS_SPECIFIER,
			(match, quote, specifier) => {
				const libraryPath = aliasPath(specifier);
				if (libraryPath === null) return match;
				const published = publishedSpecifier(libraryPath);
				if (published === null) offenders.push(`${plugin}/${file}: ${specifier}`);
				return published === null ? match : `${quote}${published}${quote}`;
			}
		);
		rewritten.push({ plugin, file, text });
	}
}

if (offenders.length) {
	console.error(
		'sync-consumer-plugins: alias imports of no published entry point — these files reach past the public barrels:\n  ' +
			offenders.join('\n  ')
	);
	process.exit(1);
}

// Nothing is written, and the previous output not cleared, until the gate has passed over
// every file — otherwise a failed run leaves a tree a later build consumes as checked.
rmSync(OUT, { recursive: true, force: true });
for (const { plugin, file, text } of rewritten) {
	mkdirSync(join(OUT, plugin), { recursive: true });
	writeFileSync(join(OUT, plugin, file), text);
}
console.log('sync-consumer-plugins: OK');
