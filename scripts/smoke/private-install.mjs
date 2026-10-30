// Gives a script its own node_modules when the one it was handed is a link, as a lane worktree's
// examples/consumer/node_modules links to the main checkout's install: nothing writes through the link.
import { lstatSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';

/**
 * Runs `run` with `dir` as a plain directory of its own. A linked `dir` loses its link for the run
 * and gets it back afterwards, thrown or not; the link's target is never written.
 * @template T
 * @param {string} dir
 * @param {() => T} run
 * @returns {T}
 */
export function withPrivateInstall(dir, run) {
	if (!isLink(dir)) return run();
	const target = readlinkSync(dir);
	unlinkSync(dir);
	try {
		return run();
	} finally {
		if (!isLink(dir)) {
			rmSync(dir, { recursive: true, force: true });
			// Windows needs a junction (a symlink wants admin rights); other platforms ignore the type.
			symlinkSync(target, dir, 'junction');
		}
	}
}

/** @param {string} path */
function isLink(path) {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}
