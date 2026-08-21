// Full external-consumer realism gate: build the package, pack it, install the tarball
// into examples/consumer, build it, and run the SSR-no-crash + hydration smoke.
import { execSync, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

// Rollup's cyclic cross-chunk re-export warning says a published barrel sits inside an
// import cycle, which breaks execution order in a code-split consumer. SvelteKit owns
// `rollupOptions.onwarn`, so the build output is the only place to read it.
function buildConsumer() {
	const built = spawnSync('npm run build', {
		cwd: 'examples/consumer',
		encoding: 'utf8',
		shell: true
	});
	process.stdout.write(built.stdout ?? '');
	process.stderr.write(built.stderr ?? '');
	if (built.status !== 0) process.exit(built.status ?? 1);
	if (`${built.stdout}${built.stderr}`.includes('was reexported through module')) {
		console.error('consumer-smoke: a published barrel is inside an import cycle (see above)');
		process.exit(1);
	}
}

// `--with-deps` installs OS libraries and is Linux-only (CI); elsewhere it's a
// no-op/error, so add it only on linux.
const withDeps = process.platform === 'linux' ? '--with-deps ' : '';

run('npm run package');
// The tarball name embeds the version, so install the file `npm pack` reports rather than a
// static pin. `--no-save` keeps the tracked `file:../..` pin from churning to that name.
const packOutput = execSync('npm pack', { encoding: 'utf8' });
const tarball = packOutput.trim().split(/\r?\n/).pop();
run('node scripts/verify-pack.mjs'); // published paths present AND no test files ship
// Force a fresh extract — npm may reuse a cached copy for an unchanged version,
// which would make an edit → repack loop test stale bits.
rmSync('examples/consumer/node_modules/@voithos-labs/aragonite', { recursive: true, force: true });
run(`npm install --no-save ../../${tarball}`, { cwd: 'examples/consumer' });
// The consumer's own check/build/test pre-hooks sync the dogfood plugin sources, so this
// gate runs the same $lib rewrite a fresh clone does — no separate sync call to drift.
run('npm run check', { cwd: 'examples/consumer' }); // public entry points type-resolve from outside
buildConsumer(); // bundle + exports validation, chunk-cycle warnings fatal
run(`npx playwright install ${withDeps}chromium`, { cwd: 'examples/consumer' });
run('npm test', { cwd: 'examples/consumer' }); // request-time SSR no-crash + hydration gate

console.log('consumer-smoke: OK');
