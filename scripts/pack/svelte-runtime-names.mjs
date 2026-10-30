// The Svelte runtime names a set of plugin sources reaches once compiled: what the core's prebuilt
// `runtime/svelte` subpaths export, so a separately built plugin finds its runtime in the editor's
// one embedded copy of Svelte. The names are read off the compiler's output for those sources.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { VERSION, compile, compileModule } from 'svelte/compiler';
import { parseAst, transformWithOxc } from 'vite';

/** The options a plugin's prebuilt compiles a component with; no runtime subpath carries the
 *  version disclosure. */
export const PREBUILT_COMPILER_OPTIONS = /** @type {const} */ ({
	runes: true,
	discloseVersion: false
});

/** The Svelte modules a prebuilt plugin may import, each with the core subpath that stands in for it. */
export const RUNTIME_SUBPATHS = /** @type {const} */ ({
	svelte: '@voithos-labs/aragonite/runtime/svelte',
	'svelte/internal/client': '@voithos-labs/aragonite/runtime/svelte/internal/client'
});

/**
 * Every runtime name the `.svelte`, `.svelte.ts` and `.ts` files under `dirs` import once compiled,
 * by Svelte module, plus each Svelte module they import that no runtime subpath stands in for.
 * @param {string[]} dirs
 * @returns {Promise<{ names: Record<keyof typeof RUNTIME_SUBPATHS, Set<string>>, unsupported: Set<string> }>}
 */
export async function runtimeNamesUsedBy(dirs) {
	const names = { svelte: new Set(), 'svelte/internal/client': new Set() };
	const unsupported = new Set();
	for (const file of dirs.flatMap(sourceFiles)) {
		for (const { source, imported } of svelteImports(await compiled(file))) {
			if (!(source in names)) unsupported.add(`${source} (${file})`);
			else imported.forEach((name) => names[/** @type {keyof typeof names} */ (source)].add(name));
		}
	}
	return { names, unsupported };
}

/** The version of the Svelte this toolchain compiles with and the core's prebuilt embeds. */
export const SVELTE_VERSION = VERSION;

/**
 * Builds each core `runtime/svelte` source as an export of the names the plugin sources under
 * `pluginDirs` reach, since a star export would keep every Svelte internal in the prebuilt.
 * @param {() => string[]} pluginDirs
 * @returns {import('vite').Plugin}
 */
export function runtimeEntriesExportWhatPluginsUse(pluginDirs) {
	const sources = Object.keys(RUNTIME_SUBPATHS).map((module) => [
		`src/lib/runtime/${module}.ts`,
		module
	]);
	/** @type {ReturnType<typeof runtimeNamesUsedBy> | undefined} */
	let used;
	return {
		name: 'runtime-entries-export-what-plugins-use',
		enforce: 'pre',
		async load(id) {
			const posix = id.replaceAll('\\', '/');
			const module = sources.find(([file]) => posix.endsWith(file))?.[1];
			if (module === undefined) return null;
			const { names, unsupported } = await (used ??= runtimeNamesUsedBy(pluginDirs()));
			if (unsupported.size > 0) {
				throw new Error(
					`no runtime subpath carries the Svelte module ${[...unsupported].join(', ')}`
				);
			}
			const list = [...names[/** @type {keyof typeof names} */ (module)]].sort().join(', ');
			const version =
				module === 'svelte' ? `export const SVELTE_VERSION = ${JSON.stringify(VERSION)};\n` : '';
			return `export { ${list} } from '${module}';\n${version}`;
		}
	};
}

// ── Internal ────────────────────────────────────────────────────────────────

/** @param {string} dir */
function sourceFiles(dir) {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.(svelte|ts)$/.test(entry.name))
		.filter((entry) => !entry.name.endsWith('.d.ts'))
		.map((entry) => path.join(entry.parentPath, entry.name));
}

/** The client JavaScript a prebuilt build makes of `file`. @param {string} file */
async function compiled(file) {
	const code = readFileSync(file, 'utf8');
	if (file.endsWith('.svelte')) {
		return compile(code, { ...PREBUILT_COMPILER_OPTIONS, filename: file, generate: 'client' }).js
			.code;
	}
	const js = (await transformWithOxc(code, file, { lang: 'ts' })).code;
	if (!file.endsWith('.svelte.ts')) return js;
	return compileModule(js, { filename: file, generate: 'client', dev: false }).js.code;
}

/**
 * Each `svelte` import in `code` with the names it reaches: its named imports, or the members read
 * off a namespace import (`$.template_effect`), the shape a compiled component imports the runtime in.
 * @param {string} code
 */
function svelteImports(code) {
	/** @type {{ source: string, imported: string[] }[]} */
	const found = [];
	/** @type {Map<string, string>} */
	const namespaces = new Map();
	/** @type {Map<string, Set<string>>} */
	const members = new Map();
	const visit = (/** @type {any} */ node) => {
		if (node === null || typeof node !== 'object') return;
		if (Array.isArray(node)) return node.forEach(visit);
		if (node.type === 'ImportDeclaration' && /^svelte(\/|$)/.test(node.source.value)) {
			const imported = [];
			for (const spec of node.specifiers) {
				if (spec.type === 'ImportNamespaceSpecifier')
					namespaces.set(spec.local.name, node.source.value);
				else if (spec.type === 'ImportSpecifier') imported.push(spec.imported.name);
			}
			found.push({ source: node.source.value, imported });
		}
		if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && !node.computed) {
			const seen = members.get(node.object.name) ?? new Set();
			members.set(node.object.name, seen.add(node.property.name));
		}
		for (const value of Object.values(node)) visit(value);
	};
	visit(parseAst(code));
	for (const [local, source] of namespaces) {
		found.push({ source, imported: [...(members.get(local) ?? [])] });
	}
	return found;
}
