// Full external-consumer realism gate: build the package, pack it, install the
// tarball into examples/consumer, build it, and run the SSR-no-crash + hydration
// smoke. Single entry for local runs and CI; exits non-zero on any step failure.
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
// `--with-deps` installs OS libraries and is Linux-only (CI); elsewhere it's a
// no-op/error, so add it only on linux.
const withDeps = process.platform === 'linux' ? '--with-deps ' : '';

run('npm run package');
// The tarball name embeds the version; install the file `npm pack` reports
// instead of the consumer's static pin so a version bump can't strand the smoke
// on a stale tarball name. `--no-save` (below) keeps the tracked `file:../..` pin
// intact — the source of truth for a fresh clone — so a local run stops churning
// the consumer's package.json to the packed tarball name.
const packOutput = execSync('npm pack', { encoding: 'utf8' });
const tarball = packOutput.trim().split(/\r?\n/).pop();
run('node scripts/verify-pack.mjs'); // published paths present AND no test files ship
// Force a fresh extract — npm may reuse a cached copy for an unchanged version,
// which would make an edit → repack loop test stale bits.
rmSync('examples/consumer/node_modules/aragonite', { recursive: true, force: true });
run(`npm install --no-save ../../${tarball}`, { cwd: 'examples/consumer' });
// The consumer's own check/build/test pre-hooks sync the dogfood plugin sources
// ($lib rewritten) before each step, so this gate runs the same $lib rewrite a
// fresh clone does — no separate sync call to drift from what a consumer runs.
run('npm run check', { cwd: 'examples/consumer' }); // public entry points type-resolve from outside
run('npm run build', { cwd: 'examples/consumer' }); // bundle + exports validation
run(`npx playwright install ${withDeps}chromium`, { cwd: 'examples/consumer' });
run('npm test', { cwd: 'examples/consumer' }); // request-time SSR no-crash + hydration gate

console.log('consumer-smoke: OK');
