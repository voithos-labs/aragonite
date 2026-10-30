// Full external-consumer realism gate: build the package, pack it, install the tarball
// into examples/consumer, build it, and run the SSR-no-crash + hydration smoke.
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { withPrivateInstall } from './private-install.mjs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

// `--with-deps` installs OS libraries and only works on Linux (CI).
const withDeps = process.platform === 'linux' ? '--with-deps ' : '';

run('npm run package');
// The tarball name embeds the version, so install the file `npm pack` reports; `--no-save` keeps
// the tracked `file:../..` pin from churning to that name.
const packOutput = execSync('npm pack', { encoding: 'utf8' });
const tarball = packOutput.trim().split(/\r?\n/).pop();
run('node scripts/pack/verify-pack.mjs'); // published paths present and no test files ship
// A worktree's consumer install is a link to the main checkout's, so the smoke installs privately.
withPrivateInstall('examples/consumer/node_modules', () => {
	// Force a fresh extract: npm may reuse a cached copy for an unchanged version.
	rmSync('examples/consumer/node_modules/@voithos-labs/aragonite', {
		recursive: true,
		force: true
	});
	run(`npm install --no-save ../../${tarball}`, { cwd: 'examples/consumer' });
	// The consumer's check/build/test pre-hooks sync the dogfood plugin sources, as a fresh clone does.
	run('npm run check', { cwd: 'examples/consumer' }); // public entry points type-resolve from outside
	run('npm run build', { cwd: 'examples/consumer' }); // a cycle through a published entry fails it
	run(`npx playwright install ${withDeps}chromium`, { cwd: 'examples/consumer' });
	run('npm test', { cwd: 'examples/consumer' }); // request-time SSR no-crash + hydration gate
});

console.log('consumer-smoke: OK');
