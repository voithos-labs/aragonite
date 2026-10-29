// Gates `dist/prebuilt`, the build a host gets when its bundler doesn't compile Svelte: it carries
// its own Svelte, loads in Node, keeps one plugin registry across its entry points, and stays
// within its size budget. Run by verify-pack.mjs after `npm run package`.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parseAst } from 'vite';
import { publishedEntryPoints } from '../lib-alias.mjs';
import { prebuiltExternals } from './pack-manifest.mjs';

const PREBUILT_DIR = 'dist/prebuilt';

// Gzipped bytes per entry, each a little above what it measured, and 23,656 of CSS. A group owns
// the files its entry loads that no earlier group does. Measured: index 478,123, plugin 9,470,
// svelte 634, admonitions 4,392, details 3,983, emoji 16,354, footnotes 4,330, highlight-occurrences
// 1,573, latex 7,474, mermaid 6,916, parrot 4,315, slash-commands 1,962, toc 2,828, testing 18,601.
/** @type {{ js: Record<string, number>, css: number }} */
const BUDGET = {
	js: {
		index: 478_500,
		plugin: 9_600,
		svelte: 750,
		'plugins/admonitions': 4_650,
		'plugins/details': 4_100,
		'plugins/emoji': 16_500,
		'plugins/footnotes': 4_450,
		'plugins/highlight-occurrences': 1_700,
		'plugins/latex': 7_900,
		'plugins/mermaid': 7_050,
		'plugins/parrot': 4_450,
		'plugins/slash-commands': 2_100,
		'plugins/toc': 2_950,
		testing: 18_750
	},
	css: 23_800
};

/**
 * Every failed check, as a message; an empty list means the prebuilt passed.
 * @returns {Promise<string[]>}
 */
export async function verifyPrebuilt() {
	const failures = [];
	const entries = publishedEntryPoints();
	const files = listFiles(PREBUILT_DIR);
	const missing = entries.filter((entry) => !files.includes(entry.prebuilt));
	if (missing.length > 0 || files.length === 0) {
		return [`no prebuilt build for ${missing.map((entry) => entry.subpath).join(', ')}`];
	}
	const scripts = files.filter((file) => file.endsWith('.js'));
	const imports = new Map(scripts.map((file) => [file, bareImports(file)]));

	for (const [file, specifiers] of imports) {
		const foreign = specifiers.filter((specifier) => !isExternal(specifier));
		if (foreign.length > 0) {
			failures.push(
				`${file} imports ${foreign.join(', ')}, which the prebuilt must carry or list as external`
			);
		}
	}
	failures.push(...(await loadsWithoutDom(entries, imports)));
	failures.push(...(await sharesOneRegistry(entries)));
	failures.push(...overBudget(files));
	return failures;
}

// ── Checks ───────────────────────────────────────────────────────────────────

/**
 * Imports every entry in Node, where there is no DOM, as a server render does. An entry that imports
 * a stylesheet is skipped: Node loads no CSS, and the source build has the same import.
 * @param {import('../lib-alias.mjs').EntryPoint[]} entries
 * @param {Map<string, string[]>} imports
 */
async function loadsWithoutDom(entries, imports) {
	if ('document' in globalThis) return ['verify-prebuilt must run where there is no DOM'];
	const failures = [];
	for (const entry of entries) {
		if (imports.get(entry.prebuilt)?.some(isStylesheet)) continue;
		try {
			await import(pathToFileURL(path.resolve(entry.prebuilt)).href);
		} catch (error) {
			failures.push(`${entry.prebuilt} fails to import in Node: ${String(error)}`);
		}
	}
	return failures;
}

/**
 * A kind registered through the prebuilt `/plugin` entry must parse through the prebuilt root, or
 * the entries hold separate copies of the registries.
 * @param {import('../lib-alias.mjs').EntryPoint[]} entries
 */
async function sharesOneRegistry(entries) {
	const load = (/** @type {string} */ subpath) => {
		const entry = entries.find((candidate) => candidate.subpath === subpath);
		return import(pathToFileURL(path.resolve(entry?.prebuilt ?? '')).href);
	};
	const root = await load('.');
	const plugin = await load('./plugin');
	root.installPlugins([
		plugin.definePlugin({
			name: 'prebuilt-probe',
			setup() {
				const kind = plugin.declarePluginKind('prebuiltProbe');
				plugin.registerBlockKind(kind, {
					gapEdges: 'none',
					mergeRole: 'not-mergeable',
					editable: true,
					supportsInline: false,
					conformanceFixture: '%%probe\n',
					// The prebuilt can't compile a component, so its one view is the text block.
					view: plugin.textBlockView(),
					opener: {
						priority: 25,
						interruptsParagraph: false,
						tryOpen(/** @type {any} */ ctx) {
							if (!ctx.line.text.startsWith('%%probe')) return null;
							return {
								node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
								consumed: 1
							};
						}
					},
					closure: plugin.simpleLeafClosure({
						focus: { mode: 'implemented', via: 'probe' },
						searchPaint: { mode: 'implemented', via: 'probe' },
						undo: { mode: 'implemented', via: 'probe' },
						simOracle: { mode: 'inherit-default' }
					})
				});
			}
		})
	]);
	const kind = root.parse('%%probe\n').children[0]?.kind;
	return kind === 'prebuiltProbe'
		? []
		: [
				`a kind registered through the prebuilt /plugin parsed as "${kind}" through the prebuilt root`
			];
}

/**
 * Each budgeted group owns the files its entries load that no earlier group loads, so a failure
 * names the entry that grew.
 * @param {string[]} files
 */
function overBudget(files) {
	const groups = budgetGroups(files);
	const failures = [];
	let js = 0;
	for (const [name, owned] of groups) {
		const bytes = gzippedBytes(owned);
		js += bytes;
		const budget = BUDGET.js[name];
		console.log(`verify-prebuilt: ${name} ${bytes} B of JS, gzipped`);
		if (budget === undefined) failures.push(`the prebuilt entry "${name}" has no JS budget`);
		else if (bytes > budget)
			failures.push(`the prebuilt ${name} JS is ${bytes} B gzipped, over its ${budget} B budget`);
	}
	for (const name of Object.keys(BUDGET.js)) {
		if (!groups.has(name)) failures.push(`the JS budget for "${name}" matches no prebuilt entry`);
	}
	const css = gzippedBytes(files.filter((file) => file.endsWith('.css')));
	console.log(`verify-prebuilt: ${js} B of JS and ${css} B of CSS, gzipped`);
	if (css > BUDGET.css)
		failures.push(`the prebuilt CSS is ${css} B gzipped, over its ${BUDGET.css} B budget`);
	return failures;
}

/**
 * Budget name to the JS files it owns: the root closure, then /plugin, /svelte, each bundled plugin
 * and /testing, each owning what no earlier group loads.
 * @param {string[]} files
 * @returns {Map<string, string[]>}
 */
function budgetGroups(files) {
	const scripts = files.filter((file) => file.endsWith('.js'));
	const at = (/** @type {string} */ name) => `${PREBUILT_DIR}/${name}`;
	const plugins = scripts
		.filter((file) => /\/plugins\/[^/]+\/index\.js$/.test(file))
		.map((file) => file.split('/')[3])
		.sort();
	/** @type {[string, string[]][]} */
	const order = [
		['index', [at('index.js')]],
		['plugin', [at('plugin.js')]],
		['svelte', [at('svelte.js')]],
		...plugins.map(
			(name) =>
				/** @type {[string, string[]]} */ ([
					`plugins/${name}`,
					scripts.filter((file) => file.startsWith(at(`plugins/${name}/`)))
				])
		),
		['testing', [at('testing.js')]]
	];
	const claimed = new Set();
	const groups = new Map();
	for (const [name, roots] of order) {
		const owned = [...loadClosure(roots)].filter((file) => !claimed.has(file));
		owned.forEach((file) => claimed.add(file));
		groups.set(name, owned);
	}
	const stray = scripts.filter((file) => !claimed.has(file));
	if (stray.length > 0) groups.set('unreached', stray);
	return groups;
}

/**
 * The files reachable from `roots` through relative imports, dynamic ones included.
 * @param {string[]} roots
 */
function loadClosure(roots) {
	const seen = new Set(roots);
	for (const file of seen) {
		const source = readFileSync(file, 'utf8');
		for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.[^"']+)["']/g)) {
			seen.add(path.posix.join(path.posix.dirname(file), match[1]));
		}
	}
	return seen;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** @param {string} dir */
function listFiles(dir) {
	try {
		return readdirSync(dir, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) =>
				path.relative('.', path.join(entry.parentPath, entry.name)).replaceAll('\\', '/')
			);
	} catch {
		return [];
	}
}

/**
 * Every specifier a module imports that isn't a relative path, read from the parsed module so an
 * import named in a comment or a string doesn't count.
 * @param {string} file
 * @returns {string[]}
 */
function bareImports(file) {
	/** @type {string[]} */
	const found = [];
	const visit = (/** @type {any} */ node) => {
		if (node === null || typeof node !== 'object') return;
		if (Array.isArray(node)) return node.forEach(visit);
		const isImport = /^(Import|ExportNamed|ExportAll)Declaration$|^ImportExpression$/.test(
			node.type
		);
		const specifier = isImport && node.source?.type === 'Literal' ? node.source.value : null;
		if (typeof specifier === 'string' && !specifier.startsWith('.')) found.push(specifier);
		for (const value of Object.values(node)) visit(value);
	};
	visit(parseAst(readFileSync(file, 'utf8')));
	return found;
}

const EXTERNALS = prebuiltExternals();

/** @param {string} specifier */
const isExternal = (specifier) =>
	EXTERNALS.some((name) => specifier === name || specifier.startsWith(`${name}/`));

/** @param {string} specifier */
const isStylesheet = (specifier) => specifier.endsWith('.css');

/** @param {string[]} files */
const gzippedBytes = (files) =>
	files.reduce((sum, file) => sum + gzipSync(readFileSync(file)).length, 0);
