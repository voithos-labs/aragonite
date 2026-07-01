// Full external-consumer realism gate: build the package, pack it, install the
// tarball into examples/consumer, build it, and run the SSR-no-crash + hydration
// smoke. Single entry for local runs and CI; exits non-zero on any step failure.
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
// `--with-deps` installs OS libraries and is Linux-only (CI); elsewhere it's a
// no-op/error, so add it only on linux. The consumer refs the tarball via
// `file:../../aragonite-<version>.tgz`, so `npm pack` at the repo root is the
// single source — no copy needed.
const withDeps = process.platform === 'linux' ? '--with-deps ' : '';

run('npm run package');
run('npm pack');
// Force a fresh extract — npm may reuse a cached copy for an unchanged version,
// which would make an edit → repack loop test stale bits.
rmSync('examples/consumer/node_modules/aragonite', { recursive: true, force: true });
run('npm install', { cwd: 'examples/consumer' });
run('npm run build', { cwd: 'examples/consumer' }); // bundle + exports validation
run(`npx playwright install ${withDeps}chromium`, { cwd: 'examples/consumer' });
run('npm test', { cwd: 'examples/consumer' }); // request-time SSR no-crash + hydration gate

console.log('consumer-smoke: OK');
