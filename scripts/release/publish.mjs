// Publishes the core, then every workspace package, skipping any npm already holds at its version,
// so a run that stops partway (an expired one-time code, a dropped connection) finishes when run
// again. Arguments after the script name (`--dry-run`) reach every `npm publish`.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { workspacePackages } from '../workspace.mjs';

/** @typedef {{ name: string, version: string, workspace: string | null }} ReleasePackage */

/**
 * The packages a release publishes, the core first, each with the workspace `npm publish -w` picks
 * (null for the core at the root).
 * @returns {ReleasePackage[]}
 */
export function releasePackages() {
	const root = JSON.parse(readFileSync('package.json', 'utf8'));
	return [
		{ name: root.name, version: root.version, workspace: null },
		...workspacePackages()
			.filter(({ manifest }) => !manifest.private)
			.map(({ dir, manifest }) => ({
				name: manifest.name,
				version: manifest.version,
				workspace: dir
			}))
	];
}

/**
 * Splits `packages` into those still to publish and those npm already holds, keeping their order.
 * @param {ReleasePackage[]} packages
 * @param {(pkg: ReleasePackage) => boolean} isPublished
 */
export function publishPlan(packages, isPublished) {
	/** @type {ReleasePackage[]} */
	const todo = [];
	/** @type {ReleasePackage[]} */
	const done = [];
	for (const pkg of packages) (isPublished(pkg) ? done : todo).push(pkg);
	return { todo, done };
}

/** @param {ReleasePackage} pkg */
function onNpm({ name, version }) {
	try {
		const out = execSync(`npm view "${name}@${version}" version`, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		});
		return out.trim() === version;
	} catch (error) {
		// A package npm has never seen (its first release) is unpublished; any other failure stops.
		if (/E404/.test(String(/** @type {{ stderr?: unknown }} */ (error).stderr))) return false;
		throw error;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const extra = process.argv
		.slice(2)
		.map((arg) => ` ${JSON.stringify(arg)}`)
		.join('');
	const { todo, done } = publishPlan(releasePackages(), onNpm);
	for (const pkg of done) console.log(`publish: ${pkg.name}@${pkg.version} is on npm, skipped`);
	for (const pkg of todo) {
		const pick = pkg.workspace === null ? '' : ` -w "${pkg.workspace}"`;
		try {
			execSync(`npm publish${pick}${extra}`, { stdio: 'inherit' });
		} catch {
			console.error(
				`publish: ${pkg.name}@${pkg.version} failed. Run \`npm run release:publish\` again ` +
					'once the cause is fixed; the packages already on npm are skipped.'
			);
			process.exit(1);
		}
	}
}
