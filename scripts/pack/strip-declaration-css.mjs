// A stylesheet import carries no types, and a host type-checking without a CSS module declaration
// fails on it (TS2882), so a package's declarations lose their side-effect `.css` imports.
// `node scripts/pack/strip-declaration-css.mjs <dist dir>`, after svelte-package.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS_IMPORT = /^import\s+['"][^'"]+\.css['"];?[ \t]*\r?\n/gm;

/** @param {string} dist */
export function stripDeclarationCss(dist) {
	for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue;
		const file = path.join(entry.parentPath, entry.name);
		const types = readFileSync(file, 'utf8');
		const stripped = types.replace(CSS_IMPORT, '');
		if (stripped !== types) writeFileSync(file, stripped);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	stripDeclarationCss(process.argv[2] ?? 'dist');
