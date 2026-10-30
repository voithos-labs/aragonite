// Fails when a wrapper package under `packages/` drifts from the core: each must carry the root's
// version and peer the core at exactly that version, since every package releases together. The
// version constant the library reports (`src/lib/version.ts`) must match the root's too.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE = '@voithos-labs/aragonite';

/**
 * Every way the wrappers disagree with the root manifest, as messages; empty when in step.
 * @param {{ version: string }} root
 * @param {{ name: string, version: string, peerDependencies?: Record<string, string> }[]} wrappers
 * @returns {string[]}
 */
export function lockstepDrift(root, wrappers) {
	const problems = [];
	for (const wrapper of wrappers) {
		if (wrapper.version !== root.version) {
			problems.push(`${wrapper.name} is at ${wrapper.version}, the core at ${root.version}`);
		}
		const peer = wrapper.peerDependencies?.[CORE];
		if (peer !== root.version) {
			problems.push(`${wrapper.name} peers ${CORE} at ${peer ?? 'nothing'}, not ${root.version}`);
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

/** The root manifest and every workspace manifest, read from `dir`. */
export function readManifests(dir = '.') {
	/** @param {string} file */
	const read = (file) => JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
	const root = read('package.json');
	const wrappers = readdirSync(path.join(dir, 'packages'))
		.map((name) => path.join('packages', name, 'package.json'))
		.filter((file) => existsSync(path.join(dir, file)))
		.map(read);
	const constant = readFileSync(path.join(dir, 'src/lib/version.ts'), 'utf8');
	const libraryVersion = /ARAGONITE_VERSION = '([^']+)'/.exec(constant)?.[1] ?? null;
	return { root, wrappers, libraryVersion };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const { root, wrappers, libraryVersion } = readManifests();
	const problems = [...lockstepDrift(root, wrappers), ...libraryVersionDrift(root, libraryVersion)];
	if (problems.length > 0) {
		console.error('check-lockstep:\n  ' + problems.join('\n  '));
		process.exit(1);
	}
	console.log(`check-lockstep: ${wrappers.length} wrapper(s) at ${root.version}`);
}
