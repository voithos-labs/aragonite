// Full external-consumer realism gate: build the packages, pack them, install the tarballs of the
// ones examples/consumer depends on, build it, and run the SSR-no-crash + hydration smoke.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { withPrivateInstall } from './private-install.mjs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

// `--with-deps` installs OS libraries and only works on Linux (CI).
const withDeps = process.platform === 'linux' ? '--with-deps ' : '';
const PACKS = 'tmp/packs';

run('npm run package');
run('node scripts/pack/verify-pack.mjs'); // published paths present and no test files ship
rmSync(PACKS, { recursive: true, force: true });
mkdirSync(PACKS, { recursive: true });
// Built just above, so the pack skips the lifecycle scripts that would build it all again. The
// tarball names embed the version, so install the files `npm pack` reports.
const packed = JSON.parse(
	execSync(
		`npm pack --workspaces --include-workspace-root --ignore-scripts --json --pack-destination ${PACKS}`,
		{ encoding: 'utf8' }
	)
);
const tarballs = new Map(
	Object.values(packed).map((pack) => [pack.name, path.resolve(PACKS, pack.filename)])
);
const { dependencies } = JSON.parse(readFileSync('examples/consumer/package.json', 'utf8'));
const own = Object.keys(dependencies).filter((name) => tarballs.has(name));
// A worktree's consumer install is a link to the main checkout's, so the smoke installs privately.
withPrivateInstall('examples/consumer/node_modules', () => {
	// Force a fresh extract: npm may reuse a cached copy for an unchanged version.
	rmSync('examples/consumer/node_modules/@voithos-labs', { recursive: true, force: true });
	// `--no-save` keeps the tracked `file:` pins from churning to the tarball names.
	run(`npm install --no-save ${own.map((name) => `"${tarballs.get(name)}"`).join(' ')}`, {
		cwd: 'examples/consumer'
	});
	// The consumer's check/build/test pre-hooks sync the dogfood plugin sources, as a fresh clone does.
	run('npm run check', { cwd: 'examples/consumer' }); // public entry points type-resolve from outside
	run('npm run build', { cwd: 'examples/consumer' }); // a cycle through a published entry fails it
	run(`npx playwright install ${withDeps}chromium`, { cwd: 'examples/consumer' });
	run('npm test', { cwd: 'examples/consumer' }); // request-time SSR no-crash + hydration gate
});

console.log('consumer-smoke: OK');
