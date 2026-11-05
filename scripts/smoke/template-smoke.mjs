// The plugin template's gate, walked the way a stranger walks it: runs the packed create package's
// bin outside the repo, installs the result against this checkout's packed editor, builds it, runs
// both of its test suites and its plugin check, then installs its packed package in an empty
// project as a plugin listing does and as a strict host does (`skipLibCheck` off). It leaves every
// tarball in `tmp/plugin-packs` for CI's checks.
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packWorkspaces } from '../pack/pack-workspaces.mjs';

const PACKS = path.resolve('tmp/plugin-packs');
// The folder the stranger names, so the package's name; `plugins.yml` finds its tarball by it.
const NAME = 'my-plugin';
// `--with-deps` installs OS libraries and only works on Linux (CI).
const withDeps = process.platform === 'linux' ? '--with-deps ' : '';
const PORT = process.env.E2E_PORT ?? '5180';
const STRICT_HOST = {
	compilerOptions: {
		target: 'ES2022',
		module: 'ESNext',
		moduleResolution: 'bundler',
		lib: ['ES2022', 'DOM', 'DOM.Iterable'],
		strict: true,
		skipLibCheck: false,
		noEmit: true
	},
	include: ['host.ts']
};

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

run('npm run package');
const packs = packWorkspaces(PACKS);
const editor = packs.get('@voithos-labs/aragonite');
const create = packs.get('@voithos-labs/create-aragonite-plugin');

// Outside the repo, so nothing resolves through this checkout's own node_modules. A cache of its
// own, so npm can't answer with a starter it ran on an earlier pass.
const stranger = mkdtempSync(path.join(tmpdir(), 'aragonite-stranger-'));
run(`npm exec --yes -- "${create}" ${NAME}`, {
	cwd: stranger,
	env: { ...process.env, npm_config_cache: path.join(stranger, '.npm') }
});
const author = path.join(stranger, NAME);
const { name, devDependencies } = JSON.parse(
	readFileSync(path.join(author, 'package.json'), 'utf8')
);
if (name !== NAME) throw new Error(`the starter named the package ${name}, not ${NAME}`);
if (!existsSync(path.join(author, '.gitignore'))) throw new Error('the starter left no .gitignore');

// The template pins the editor release it ships with, which the registry may not have yet, so the
// packed editor stands in for it without touching the template's manifest.
run(`npm install --no-save "${editor}"`, { cwd: author });
run('npm run build', { cwd: author });
run('npm test', { cwd: author });
run(`npx playwright install ${withDeps}chromium`, { cwd: author });
run('npm run test:e2e', { cwd: author, env: { ...process.env, CI: '1', PORT } });
run('npm run check:plugin', { cwd: author });

// The plugin check, the way the reusable workflow runs it: both packages in an empty project, with
// no install script of the plugin's allowed to run. TypeScript comes along for the strict host.
const { filename } = JSON.parse(
	execSync(`npm pack --ignore-scripts --json --pack-destination "${PACKS}"`, {
		cwd: author,
		encoding: 'utf8'
	})
)[0];
const plugin = path.join(PACKS, filename);
const check = mkdtempSync(path.join(tmpdir(), 'aragonite-plugin-check-'));
run('npm init -y', { cwd: check, stdio: 'ignore' });
const typescript = `typescript@${devDependencies.typescript}`;
run(`npm install --no-save --ignore-scripts "${plugin}" "${editor}" "${typescript}"`, {
	cwd: check
});
run(`npx --no-install aragonite-plugin-check ${NAME}`, { cwd: check });

// A host that type-checks every declaration it installs, both of the plugin's entries included.
writeFileSync(path.join(check, 'tsconfig.json'), JSON.stringify(STRICT_HOST));
writeFileSync(
	path.join(check, 'host.ts'),
	[
		"import { createEditor } from '@voithos-labs/aragonite';",
		`import { parrotPlugin } from '${NAME}';`,
		`import suite from '${NAME}/conformance';`,
		'createEditor(document.body, { plugins: [parrotPlugin(), ...suite.plugins] });'
	].join('\n')
);
run('npx --no-install tsc -p .', { cwd: check });

rmSync(stranger, { recursive: true, force: true });
rmSync(check, { recursive: true, force: true });
console.log('template-smoke: OK');
