// Packs the core and every workspace package, already built by `npm run package`, into one
// folder: `node scripts/pack/pack-workspaces.mjs <dir>`. The smokes install from it, and the
// plugin workflows check the bundled plugins from it, so nothing waits on a release to npm.
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Empties `dir`, packs into it with lifecycle scripts off (the build already ran, and its output
 * would land in the JSON), and answers each tarball's absolute path by package name.
 * @param {string} dir
 * @returns {Map<string, string>}
 */
export function packWorkspaces(dir) {
	const dest = path.resolve(dir);
	rmSync(dest, { recursive: true, force: true });
	mkdirSync(dest, { recursive: true });
	const out = execSync(
		`npm pack --workspaces --include-workspace-root --ignore-scripts --json --pack-destination "${dest}"`,
		{ encoding: 'utf8' }
	);
	return new Map(
		Object.values(JSON.parse(out)).map((/** @type {{ name: string, filename: string }} */ p) => [
			p.name,
			path.join(dest, p.filename)
		])
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const dir = process.argv[2];
	if (!dir) throw new Error('usage: node scripts/pack/pack-workspaces.mjs <dir>');
	for (const file of packWorkspaces(dir).values()) console.log(path.basename(file));
}
