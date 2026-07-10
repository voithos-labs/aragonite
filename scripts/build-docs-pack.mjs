// Assemble the public docs pack — the exact doc set a third-party plugin author
// receives. Inclusion criterion: ships publicly at 1.0 as authoring documentation.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

const MANIFEST = [
	'README.md',
	'docs/editor/consumer-guide.md',
	'docs/editor/plugin-guide.md',
	'docs/editor/directives.md',
	'docs/editor/gfm-reference.md'
];

const target = process.argv[2];
if (!target) {
	console.error('usage: node scripts/build-docs-pack.mjs <target-dir>');
	process.exit(1);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const doc of MANIFEST) copyFileSync(doc, join(target, basename(doc)));
console.log(`docs-pack: ${MANIFEST.length} docs → ${target}`);
