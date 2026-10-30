// svelte-package copies all of src/lib into dist, tests included; strip them before pack.
// It also writes a .d.mts beside each script (and the adapter suite's app list) a test imports,
// which would shadow that module's JSDoc types for svelte-check once it changes, so those go too.
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

for (const target of ['dist/test', 'dist/e2e']) {
	rmSync(target, { recursive: true, force: true });
}
for (const dir of ['scripts', 'examples/adapter-suite']) {
	for (const name of readdirSync(dir, { recursive: true })) {
		if (name.endsWith('.d.mts')) rmSync(`${dir}/${name}`);
	}
}

// A stylesheet import carries no types, and a host type-checking without a CSS module
// declaration fails on it (TS2882), so declarations lose their side-effect `.css` imports.
const CSS_IMPORT = /^import\s+['"][^'"]+\.css['"];?[ \t]*\r?\n/gm;
for (const entry of readdirSync('dist', { recursive: true, withFileTypes: true })) {
	if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue;
	const file = path.join(entry.parentPath, entry.name);
	const types = readFileSync(file, 'utf8');
	const stripped = types.replace(CSS_IMPORT, '');
	if (stripped !== types) writeFileSync(file, stripped);
}
