// Packs the library and asserts the tarball contains every published path.
// Run after `npm run package`. Exits non-zero (with the missing list) on any gap.
import { execSync } from 'node:child_process';

// `npm pack --json` reports files[].path relative to the package root (e.g.
// `dist/index.js`) — NOT prefixed with `package/`.
const REQUIRED = [
	'dist/index.js',
	'dist/index.d.ts',
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
console.log(
	`verify-pack: OK (${files.length} files, all ${REQUIRED.length} required paths present)`
);
