// svelte-package copies all of src/lib into dist, tests included; strip them before pack.
// It also writes a .d.mts beside each script (the bin, the adapter suite's app list) a test imports,
// which would shadow that module's JSDoc types for svelte-check once it changes, so those go too.
import { readdirSync, rmSync } from 'node:fs';
import { stripDeclarationCss } from './strip-declaration-css.mjs';

for (const target of ['dist/test', 'dist/e2e']) {
	rmSync(target, { recursive: true, force: true });
}
for (const dir of ['scripts', 'bin', 'examples/adapter-suite']) {
	for (const name of readdirSync(dir, { recursive: true })) {
		if (name.endsWith('.d.mts')) rmSync(`${dir}/${name}`);
	}
}

stripDeclarationCss('dist');
