// Packs the library and gates the tarball: every published path must be present,
// and no test/e2e/spec file may ship. Run after `npm run package`. Exits non-zero
// (with the offending list) on either failure.
import { execSync } from 'node:child_process';

// `npm pack --json` reports files[].path relative to the package root (e.g.
// `dist/index.js`) — NOT prefixed with `package/`.
const REQUIRED = [
	'dist/index.js',
	'dist/index.d.ts',
	'dist/plugin.js',
	'dist/plugin.d.ts',
	'dist/plugins/admonitions/index.js',
	'dist/plugins/admonitions/index.d.ts',
	'dist/plugins/details/index.js',
	'dist/plugins/details/index.d.ts',
	'dist/plugins/toc/index.js',
	'dist/plugins/toc/index.d.ts',
	'dist/plugins/highlight-occurrences/index.js',
	'dist/plugins/highlight-occurrences/index.d.ts',
	'dist/testing.js',
	'dist/testing.d.ts',
	'dist/components/Editor.svelte',
	'dist/styles/editor.css',
	'dist/styles/editor-theme.css'
];

// --ignore-scripts: inspect the dist/ that `npm run package` already built; without
// it, the `prepack` script re-fires and its stdout corrupts the --json output.
// execSync (shell) so the win32 `npm` → `npm.cmd` resolution works.
const out = execSync('npm pack --dry-run --json --ignore-scripts', { encoding: 'utf8' });
const files = JSON.parse(out)[0].files.map((f) => f.path);
const missing = REQUIRED.filter((p) => !files.includes(p));

if (missing.length) {
	console.error('verify-pack: tarball missing required paths:\n  ' + missing.join('\n  '));
	process.exit(1);
}

const FORBIDDEN = files.filter((p) => /(^|\/)(test|e2e)\//.test(p) || /\.(test|spec)\./.test(p));
if (FORBIDDEN.length) {
	console.error(
		`verify-pack: tarball ships ${FORBIDDEN.length} test/e2e file(s), e.g.:\n  ` +
			FORBIDDEN.slice(0, 5).join('\n  ')
	);
	process.exit(1);
}

console.log(
	`verify-pack: OK (${files.length} files, all ${REQUIRED.length} required paths present)`
);
