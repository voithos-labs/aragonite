// Fails when a workspace package (a framework wrapper or a plugin) drifts from the core: each must
// carry the root's version and peer the core at exactly that version, since every package releases
// together. The version constant the library reports (`src/lib/version.ts`) must match the root's too.
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
	const problems = [...lockstepDrift(root, packages), ...libraryVersionDrift(root, libraryVersion)];
	if (problems.length > 0) {
		console.error('check-lockstep:\n  ' + problems.join('\n  '));
		process.exit(1);
	}
	console.log(`check-lockstep: ${packages.length} workspace package(s) at ${root.version}`);
}
