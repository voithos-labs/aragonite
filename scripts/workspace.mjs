// The packages in this repo's npm workspace, read off the root package.json's `workspaces` globs,
// which of them are aragonite plugins, and where the plugin template lives.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A path, not a URL: under a jsdom test the global URL is jsdom's, which `fs` refuses.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The npm keyword that marks a package as an aragonite plugin. */
export const PLUGIN_KEYWORD = 'aragonite-plugin';

/** The package `npm create @voithos-labs/aragonite-plugin` runs, and the template it copies. */
export const CREATE_PACKAGE = 'packages/create-aragonite-plugin';
export const TEMPLATE_DIR = `${CREATE_PACKAGE}/template`;

/**
 * Whether `name` is an npm initializer, which `npm create <x>` finds by the `create-` prefix. One
 * copies a starter and never runs beside the editor, so it carries no peer on it.
 * @param {string} name
 */
export const isInitializer = (name) => /^(@[^/]+\/)?create-/.test(name);

/**
 * @typedef {object} WorkspacePackage
 * @property {string} dir Its directory from the repo root, e.g. `packages/latex`.
 * @property {Record<string, any>} manifest Its package.json.
 */

/** Every package the root's `workspaces` globs (each `<dir>/*`) name. */
export function workspacePackages() {
	const root = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
	/** @type {WorkspacePackage[]} */
	const found = [];
	for (const glob of root.workspaces ?? []) {
		const parent = glob.replace(/\/\*$/, '');
		for (const entry of readdirSync(path.join(ROOT, parent), { withFileTypes: true })) {
			const manifest = path.join(ROOT, parent, entry.name, 'package.json');
			if (!entry.isDirectory() || !existsSync(manifest)) continue;
			found.push({
				dir: `${parent}/${entry.name}`,
				manifest: JSON.parse(readFileSync(manifest, 'utf8'))
			});
		}
	}
	return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

/** The workspace packages carrying the plugin keyword. */
export function pluginPackages() {
	return workspacePackages().filter(({ manifest }) =>
		(manifest.keywords ?? []).includes(PLUGIN_KEYWORD)
	);
}
