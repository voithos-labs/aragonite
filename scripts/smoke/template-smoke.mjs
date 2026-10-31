// The plugin template's gate: copies `templates/plugin` out of the repo the way `degit` hands it to
// an author, installs it against this checkout's packed editor, builds it, runs both of its test
// suites, then runs the plugin check over its own packed package as a plugin listing would. It
// leaves every tarball it made in `tmp/plugin-packs`, which CI hands to the plugin check matrix.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PACKS = path.resolve('tmp/plugin-packs');
// `--with-deps` installs OS libraries and only works on Linux (CI).
const withDeps = process.platform === 'linux' ? '--with-deps ' : '';
const PORT = process.env.E2E_PORT ?? '5180';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
/**
 * Packs `cwd` into `PACKS` with lifecycle scripts off (everything is built first, and a build
 * would print into the JSON), answering each tarball's path by package name.
 * @param {string} cwd
 * @param {string} [flags]
 */
function pack(cwd, flags = '') {
	const out = execSync(`npm pack ${flags} --ignore-scripts --json --pack-destination "${PACKS}"`, {
		cwd,
		encoding: 'utf8'
	});
	return new Map(
		JSON.parse(out).map((/** @type {{ name: string, filename: string }} */ p) => [
			p.name,
			path.join(PACKS, p.filename)
		])
	);
}

run('npm run package');
rmSync(PACKS, { recursive: true, force: true });
mkdirSync(PACKS, { recursive: true });
const editor = pack('.', '--workspaces --include-workspace-root').get('@voithos-labs/aragonite');

// Outside the repo, so nothing resolves through this checkout's own node_modules.
const author = mkdtempSync(path.join(tmpdir(), 'aragonite-template-'));
cpSync('templates/plugin', author, {
	recursive: true,
	filter: (from) => !/[\\/](node_modules|dist|test-results)([\\/]|$)/.test(from)
});
// The template pins the editor release it ships with, which the registry may not have yet, so the
// packed editor stands in for it without touching the template's manifest.
run(`npm install --no-save "${editor}"`, { cwd: author });
run('npm run build', { cwd: author });
run('npm test', { cwd: author });
run(`npx playwright install ${withDeps}chromium`, { cwd: author });
run('npm run test:e2e', { cwd: author, env: { ...process.env, CI: '1', PORT } });

// The plugin check, the way the reusable workflow runs it: both packages in an empty project, with
// no install script of the plugin's allowed to run.
const [[name, plugin]] = pack(author);
const check = mkdtempSync(path.join(tmpdir(), 'aragonite-plugin-check-'));
run('npm init -y', { cwd: check, stdio: 'ignore' });
run(`npm install --no-save --ignore-scripts "${plugin}" "${editor}"`, { cwd: check });
run(`npx --no-install aragonite-plugin-check ${name}`, { cwd: check });

rmSync(author, { recursive: true, force: true });
rmSync(check, { recursive: true, force: true });
console.log('template-smoke: OK');
