// Packs the library and gates the tarball: every published path must be present,
// and no test/e2e/spec file may ship. Run after `npm run package`. Exits non-zero
// (with the offending list) on either failure.
//
// REQUIRED is derived from package.json `exports` (see pack-manifest.mjs), not a
// hand-maintained list — a new plugin subpath added to `exports` is gated here
// automatically, so it can't be published-but-unbuilt without this failing.
import { execSync } from 'node:child_process';
import { requiredPackPaths } from './pack-manifest.mjs';

// `npm pack --json` reports files[].path relative to the package root (e.g.
// `dist/index.js`) — NOT prefixed with `package/`.
const REQUIRED = requiredPackPaths();

// Non-vacuity: a broken derivation (empty `exports`, a renamed field, a bad parse)
// must fail loud here, never silently green-light an unchecked tarball. Anchor on
// the two entry points every build ships.
if (
	REQUIRED.length === 0 ||
	!REQUIRED.includes('dist/index.js') ||
	!REQUIRED.includes('dist/plugin.js')
) {
	console.error(
		'verify-pack: derived REQUIRED is empty or missing anchor paths — check package.json exports'
	);
	process.exit(1);
}

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
