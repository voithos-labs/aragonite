// Gates a plugin package's prebuilt build, which a host gets when its bundler doesn't compile
// Svelte: it imports nothing but its declared peers, installs into the core's prebuilt as the
// same copy of the core, its types reach no Svelte, and it stays within its size budget. Run by
// verify-pack.mjs after the build.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { bareImports } from './verify-prebuilt.mjs';
import { verifyTypes } from './verify-types.mjs';

// Gzipped bytes of each package's prebuilt JS, a little above what it measured. Measured:
// admonitions 4,173, details 3,794, emoji 16,297, footnotes 4,110, highlight-occurrences 1,520,
// latex 7,210, mermaid 6,718, parrot 4,162, slash-commands 1,913, toc 2,632.
/** @type {Record<string, number>} */
const BUDGET = {
	admonitions: 4_650,
	details: 4_100,
	emoji: 16_500,
	footnotes: 4_450,
	'highlight-occurrences': 1_700,
	latex: 7_900,
	mermaid: 7_050,
	parrot: 4_450,
	'slash-commands': 2_100,
	toc: 2_950
};

const CORE_HOOK = pathToFileURL(path.resolve('scripts/pack/core-from-checkout.mjs')).href;
const SECOND_COPY = '[aragonite:invariant:plugin-one-core-copy]';

/**
 * Every failed check of the plugin package in `dir`, as a message.
 * @param {string} dir
 * @returns {string[]}
 */
export function verifyPluginPackage(dir) {
	const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
	const core = JSON.parse(readFileSync('package.json', 'utf8'));
	const prebuilt = path.join(dir, 'dist/prebuilt');
	const scripts = listFiles(prebuilt).filter((file) => file.endsWith('.js'));
	const failures = [];

	const peers = Object.keys(pkg.peerDependencies ?? {});
	for (const file of scripts) {
		for (const specifier of bareImports(file)) {
			const peer = peers.find((name) => specifier === name || specifier.startsWith(`${name}/`));
			if (peer === undefined)
				failures.push(`${pkg.name}'s ${file} imports ${specifier}, no peer of it`);
			else if (peer === core.name && !(`.${specifier.slice(peer.length)}` in core.exports)) {
				failures.push(`${pkg.name}'s ${file} imports ${specifier}, which the core doesn't export`);
			}
		}
	}

	failures.push(...installsAsOneCopy(pkg, path.join(prebuilt, 'index.js')));
	// A React or Vue host type-checks the declarations with no Svelte and no CSS module types.
	failures.push(...verifyTypes(dir).map((failure) => `${pkg.name}: ${failure}`));

	const name = path.basename(dir);
	const js = gzipped(scripts);
	const css = gzipped(listFiles(prebuilt).filter((file) => file.endsWith('.css')));
	console.log(`verify-plugin-package: ${pkg.name} ${js} B of JS and ${css} B of CSS, gzipped`);
	if (BUDGET[name] === undefined) failures.push(`${pkg.name} has no JS budget`);
	else if (js > BUDGET[name]) {
		failures.push(
			`${pkg.name}'s prebuilt JS is ${js} B gzipped, over its ${BUDGET[name]} B budget`
		);
	}
	return failures;
}

// ── Checks ───────────────────────────────────────────────────────────────────

/**
 * Installs every plugin the package's prebuilt index exports into the core's prebuilt, with dev
 * checks on, in a Node process of its own: a plugin that brought its own copy of the core warns.
 * @param {{ name: string }} pkg
 * @param {string} index
 */
function installsAsOneCopy(pkg, index) {
	const script = `
const core = await import('@voithos-labs/aragonite');
const testing = await import('@voithos-labs/aragonite/testing');
testing.configureEditorEnv({ isDev: true });
const plugin = await import(${JSON.stringify(pathToFileURL(path.resolve(index)).href)});
const factories = Object.entries(plugin).filter(([name, value]) => /Plugin$/.test(name) && typeof value === 'function');
if (factories.length === 0) throw new Error('exports no plugin factory');
core.installPlugins(factories.map(([, factory]) => factory()));
`;
	const run = spawnSync(
		process.execPath,
		['--import', CORE_HOOK, '--input-type=module', '-e', script],
		{ encoding: 'utf8' }
	);
	if (run.stderr.includes(SECOND_COPY)) {
		return [`${pkg.name}'s prebuilt installs from a second copy of the core`];
	}
	if (run.status !== 0) {
		const error = run.stderr.split('\n').find((line) => /\w*Error\b/.test(line));
		return [`${pkg.name}'s prebuilt fails to install into the core's: ${error ?? run.stderr}`];
	}
	return [];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** @param {string} dir */
function listFiles(dir) {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.join(entry.parentPath, entry.name));
}

/** @param {string[]} files */
const gzipped = (files) =>
	files.reduce((sum, file) => sum + gzipSync(readFileSync(file)).length, 0);
