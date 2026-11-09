// Fails when a workspace package drifts from the core: each carries the root's version, and each
// that runs beside the editor (a wrapper or a plugin) peers the core at exactly that version, since
// every package releases together. The library's version constant (`src/lib/version.ts`) and every
// version the plugin template names (its editor pins, its workflow tag) match too.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEMPLATE_DIR, isInitializer, workspacePackages } from '../workspace.mjs';

const CORE = '@voithos-labs/aragonite';

/**
 * Every way the workspace packages disagree with the root manifest, as messages; empty when in step.
 * @param {{ version: string }} root
 * @param {{ name: string, version: string, peerDependencies?: Record<string, string> }[]} packages
 * @returns {string[]}
 */
export function lockstepDrift(root, packages) {
	const problems = [];
	for (const pkg of packages) {
		if (pkg.version !== root.version) {
			problems.push(`${pkg.name} is at ${pkg.version}, the core at ${root.version}`);
		}
		const peer = pkg.peerDependencies?.[CORE];
		if (isInitializer(pkg.name)) {
			// npm installs a peer with the package, so `npm create` would fetch the whole editor.
			if (peer !== undefined)
				problems.push(`${pkg.name} peers ${CORE}, which it never runs beside`);
		} else if (peer !== root.version) {
			problems.push(`${pkg.name} peers ${CORE} at ${peer ?? 'nothing'}, not ${root.version}`);
		}
	}
	return problems;
}

/**
 * The library's version constant against the root manifest, as messages; empty when they match.
 * @param {{ version: string }} root
 * @param {string | null} libraryVersion
 * @returns {string[]}
 */
export function libraryVersionDrift(root, libraryVersion) {
	if (libraryVersion === root.version) return [];
	return [`src/lib/version.ts says ${libraryVersion ?? 'nothing'}, the core is at ${root.version}`];
}

/** Each file outside the template's manifest that names the editor version, with the pattern that
 *  captures it: the plugin check's workflow tag and the peer range the template's README quotes. */
export const TEMPLATE_VERSION_SITES = /** @type {const} */ ([
	[`${TEMPLATE_DIR}/.github/workflows/ci.yml`, /plugin-check\.yml@v(\d[\w.-]*)/g],
	[`${TEMPLATE_DIR}/README.md`, /`\^(\d[\w.-]*)`/g],
	['docs/guide/plugin-testing.md', /plugin-check\.yml@v(\d[\w.-]*)/g]
]);

/** Each first-party plugin value's source, with the pattern that captures the version and the
 *  editor it states. */
export const PLUGIN_VALUE_SITES = /** @type {const} */ ([
	['packages/slash-commands/src/slash-commands-plugin.ts', /(?:version|editor): '(\d[\w.-]*)'/g]
]);

/**
 * Every version the plugin template names that isn't the root's, as messages; empty when in step.
 * The template asks for the editor the way an outside plugin does: an exact devDependency and a
 * caret peer on the release it was tested against.
 * @param {{ version: string }} root
 * @param {{ devDependencies?: Record<string, string>, peerDependencies?: Record<string, string> }} manifest
 * @param {[file: string, text: string, pattern: RegExp][]} sites
 * @returns {string[]}
 */
export function templateDrift(root, manifest, sites) {
	const problems = [];
	if (manifest.devDependencies?.[CORE] !== root.version) {
		problems.push(`the template's devDependency on ${CORE} isn't ${root.version}`);
	}
	if (manifest.peerDependencies?.[CORE] !== `^${root.version}`) {
		problems.push(`the template's peer on ${CORE} isn't ^${root.version}`);
	}
	return [...problems, ...siteDrift(root, sites)];
}

/**
 * Every version the sites name that isn't the root's, and each site naming none, as messages.
 * @param {{ version: string }} root
 * @param {[file: string, text: string, pattern: RegExp][]} sites
 * @returns {string[]}
 */
export function siteDrift(root, sites) {
	const problems = [];
	for (const [file, text, pattern] of sites) {
		const found = [...text.matchAll(pattern)].map((match) => match[1]);
		if (found.length === 0) problems.push(`${file} names no editor version`);
		for (const version of found.filter((v) => v !== root.version)) {
			problems.push(`${file} names ${version}, the core is at ${root.version}`);
		}
	}
	return problems;
}

/** The plugin template's manifest and the text of each file naming its editor version. */
export function readTemplate() {
	const manifest = JSON.parse(readFileSync(`${TEMPLATE_DIR}/package.json`, 'utf8'));
	return { manifest, sites: readSites(TEMPLATE_VERSION_SITES) };
}

/**
 * Each site's text, read beside its file and pattern.
 * @param {readonly (readonly [string, RegExp])[]} list
 * @returns {[string, string, RegExp][]}
 */
export function readSites(list) {
	return list.map(([file, pattern]) => [file, readFileSync(file, 'utf8'), pattern]);
}

/** The root manifest, every workspace package's manifest and the library's version constant. */
export function readManifests() {
	const root = JSON.parse(readFileSync('package.json', 'utf8'));
	const packages = workspacePackages().map(
		({ manifest }) =>
			/** @type {{ name: string, version: string, peerDependencies?: Record<string, string> }} */ (
				manifest
			)
	);
	const constant = readFileSync('src/lib/version.ts', 'utf8');
	const libraryVersion = /ARAGONITE_VERSION = '([^']+)'/.exec(constant)?.[1] ?? null;
	return { root, packages, libraryVersion };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const { root, packages, libraryVersion } = readManifests();
	const template = readTemplate();
	const problems = [
		...lockstepDrift(root, packages),
		...libraryVersionDrift(root, libraryVersion),
		...templateDrift(root, template.manifest, template.sites),
		...siteDrift(root, readSites(PLUGIN_VALUE_SITES))
	];
	if (problems.length > 0) {
		console.error('check-lockstep:\n  ' + problems.join('\n  '));
		process.exit(1);
	}
	console.log(`check-lockstep: ${packages.length} workspace package(s) at ${root.version}`);
}
