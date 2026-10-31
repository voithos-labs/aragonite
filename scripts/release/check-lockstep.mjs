// Fails when a workspace package (a framework wrapper or a plugin) drifts from the core: each must
// carry the root's version and peer the core at exactly that version, since every package releases
// together. The version constant the library reports (`src/lib/version.ts`) and every version the
// plugin template names (its editor pins, its workflow tag, the tag authors fetch it by) match too.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { workspacePackages } from '../lib-alias.mjs';

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
		if (peer !== root.version) {
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

const TEMPLATE = 'templates/plugin';

/** Each file outside the template's manifest that names the editor version, with the pattern that
 *  captures it: the plugin check's workflow tag and the tag the template's fetch command names. */
export const TEMPLATE_VERSION_SITES = /** @type {const} */ ([
	[`${TEMPLATE}/.github/workflows/ci.yml`, /plugin-check\.yml@v(\d[\w.-]*)/g],
	[`${TEMPLATE}/README.md`, /templates\/plugin#v(\d[\w.-]*)|`\^(\d[\w.-]*)`/g],
	['docs/guide/plugin-guide.md', /templates\/plugin#v(\d[\w.-]*)/g],
	['docs/guide/plugin-testing.md', /plugin-check\.yml@v(\d[\w.-]*)/g]
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
	for (const [file, text, pattern] of sites) {
		const found = [...text.matchAll(pattern)].map((match) => match[1] ?? match[2]);
		if (found.length === 0) problems.push(`${file} names no editor version`);
		for (const version of found.filter((v) => v !== root.version)) {
			problems.push(`${file} names ${version}, the core is at ${root.version}`);
		}
	}
	return problems;
}

/** The plugin template's manifest and the text of each file naming its editor version. */
export function readTemplate() {
	const manifest = JSON.parse(readFileSync(`${TEMPLATE}/package.json`, 'utf8'));
	/** @type {[string, string, RegExp][]} */
	const sites = TEMPLATE_VERSION_SITES.map(([file, pattern]) => [
		file,
		readFileSync(file, 'utf8'),
		pattern
	]);
	return { manifest, sites };
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
		...templateDrift(root, template.manifest, template.sites)
	];
	if (problems.length > 0) {
		console.error('check-lockstep:\n  ' + problems.join('\n  '));
		process.exit(1);
	}
	console.log(`check-lockstep: ${packages.length} workspace package(s) at ${root.version}`);
}
