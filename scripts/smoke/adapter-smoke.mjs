// The framework gate: packs the core and every wrapper, installs the tarballs into each example
// app the way a user's `npm install` would, builds the apps and runs the shared adapter suite.
// `node scripts/smoke/adapter-smoke.mjs` runs every project in the suite's `APPS`; `--per-pr` runs the
// ones marked `perPr`.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { withPrivateInstall } from './private-install.mjs';
import { packWorkspaces } from '../pack/pack-workspaces.mjs';
import { APPS } from '../../examples/adapter-suite/apps.mjs';

const perPr = process.argv.includes('--per-pr');
const projects = Object.entries(APPS).filter(([, app]) => !perPr || app.perPr);
const apps = [
	...new Set(projects.map(([, app]) => path.posix.join('examples/adapter-suite', app.cwd)))
];
const PACKS = 'tmp/packs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

run('npm run package');
run('node scripts/pack/verify-pack.mjs');
const tarballs = packWorkspaces(PACKS);

withPrivateInstalls(
	apps.map((app) => `${app}/node_modules`),
	() => {
		for (const cwd of apps) {
			// Force a fresh extract: npm may reuse a cached copy for an unchanged version.
			rmSync(`${cwd}/node_modules/@voithos-labs`, { recursive: true, force: true });
			// Only the packages the app depends on, so a Vue app never gets the React wrapper's peers.
			const { dependencies } = JSON.parse(readFileSync(`${cwd}/package.json`, 'utf8'));
			const own = Object.keys(dependencies).filter((name) => tarballs.has(name));
			run(`npm install --no-save ${own.map((name) => `"${tarballs.get(name)}"`).join(' ')}`, {
				cwd
			});
			// The core's prebuilt build carries its own Svelte, so a non-Svelte app installs none (G4.183).
			if (existsSync(`${cwd}/node_modules/svelte`)) {
				throw new Error(`${cwd} installed svelte, which only a Svelte app should get`);
			}
			run('npm run build', { cwd });
		}
		const withDeps = process.platform === 'linux' ? '--with-deps ' : '';
		run(`npx playwright install ${withDeps}chromium`);
		run('npx playwright test -c examples/adapter-suite/playwright.config.ts', {
			env: { ...process.env, ADAPTER_PROJECTS: projects.map(([name]) => name).join(',') }
		});
	}
);

console.log('adapter-smoke: OK');

/**
 * @param {string[]} dirs
 * @param {() => void} body
 */
function withPrivateInstalls(dirs, body) {
	if (dirs.length === 0) return body();
	withPrivateInstall(dirs[0], () => withPrivateInstalls(dirs.slice(1), body));
}
