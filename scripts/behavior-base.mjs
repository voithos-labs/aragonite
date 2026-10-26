// Records behavior rows: a checkout's, or a commit's in a temporary worktree under
// `behavior-results/`, cached by commit and install. The base runs that commit's own suites and
// config, recorded by the same `recordSuites` as the checkout, so only the code can differ.
import { execFileSync, spawnSync } from 'node:child_process';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const SUITES = 'src/lib/test/behavior';
export const RESULTS = 'behavior-results';
const WORKTREE = /^worktree-(\d+)$/;
// The suites' time limit sits far past a normal run, so only a hung suite hits it.
const RECORD_TIMEOUT_MS = 20 * 60_000;
// Windows can hold a file open for a moment after the process using it exits.
const REMOVE = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 };

/** A failure the driver prints as one line, without a stack. */
export class BehaviorError extends Error {}

/** @param {string} root @param {string[]} args */
const git = (root, args) =>
	execFileSync('git', args, {
		cwd: root,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	}).trim();

// ── What to compare against ─────────────────────────────────────────────────

/**
 * `--against` as a record file or a commit; with no argument, where this branch left `dev`.
 * @param {string | null} against
 * @param {string} root
 * @returns {{ file: string, label: string } | { sha: string, label: string }}
 */
export function resolveAgainst(against, root) {
	if (against === null) return mergeBase(root);
	if (existsSync(against)) return { file: against, label: against };
	const sha = commitOf(against, root);
	if (!sha) throw new BehaviorError(`behavior: ${against} is neither a record file nor a commit`);
	return { sha, label: sha.startsWith(against) ? against : `${against} (${sha.slice(0, 9)})` };
}

/** @param {string} root */
function mergeBase(root) {
	const branch = ['dev', 'origin/dev'].find((name) => commitOf(name, root));
	if (!branch) {
		throw new BehaviorError(
			'behavior: no dev or origin/dev to start from; usage: npm run behavior -- --against <ref|file>'
		);
	}
	const sha = git(root, ['merge-base', 'HEAD', branch]);
	return { sha, label: `merge-base HEAD ${branch} (${sha.slice(0, 9)})` };
}

/** @param {string} ref @param {string} root */
function commitOf(ref, root) {
	try {
		return git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
	} catch {
		return null;
	}
}

// ── Recording ───────────────────────────────────────────────────────────────

/**
 * Every behavior suite's rows over the checkout at `dir`, as record text.
 * @param {string} dir
 */
export function recordSuites(dir) {
	const vitest = join(dirname(resolveFrom(dir, 'vitest/package.json')), 'vitest.mjs');
	const folder = mkdtempSync(join(tmpdir(), 'behavior-'));
	try {
		// A commit's config may opt the suites in with either variable.
		const env = { ...process.env, BEHAVIOR: '1', BEHAVIOR_RECORD: folder };
		const result = spawnSync(process.execPath, [vitest, 'run', SUITES, '--maxWorkers=4'], {
			cwd: dir,
			stdio: ['ignore', 'ignore', 'inherit'],
			env,
			timeout: RECORD_TIMEOUT_MS
		});
		if (/** @type {NodeJS.ErrnoException | undefined} */ (result.error)?.code === 'ETIMEDOUT') {
			throw new BehaviorError(
				`behavior: the suites ran past ${RECORD_TIMEOUT_MS / 60_000} min in ${dir}`
			);
		}
		if (result.status !== 0) throw new BehaviorError(`behavior: the suites failed in ${dir}`);
		const files = readdirSync(folder).filter((file) => file.endsWith('.jsonl'));
		if (files.length === 0) throw new BehaviorError(`behavior: ${dir} recorded no rows`);
		return files.map((file) => readFileSync(join(folder, file), 'utf8')).join('');
	} finally {
		rmSync(folder, REMOVE);
	}
}

/** @param {string} dir */
function recordFreshCheckout(dir) {
	const kit = join(dirname(resolveFrom(dir, '@sveltejs/kit/package.json')), 'svelte-kit.js');
	const sync = spawnSync(process.execPath, [kit, 'sync'], { cwd: dir, stdio: 'inherit' });
	if (sync.status !== 0) throw new BehaviorError(`behavior: svelte-kit sync failed in ${dir}`);
	return recordSuites(dir);
}

/** @param {string} dir @param {string} request */
const resolveFrom = (dir, request) => createRequire(join(dir, 'package.json')).resolve(request);

/**
 * What else moves a commit's rows: the Node version and the installed dependencies.
 * @param {string} root
 */
export function installOf(root) {
	const lock = join(
		dirname(dirname(resolveFrom(root, 'vitest/package.json'))),
		'.package-lock.json'
	);
	return `${process.version}\n${existsSync(lock) ? readFileSync(lock, 'utf8') : ''}`;
}

/** @param {string} sha @param {string} install */
export function cacheFile(sha, install) {
	const key = createHash('sha1').update(install).digest('hex').slice(0, 12);
	return join(RESULTS, `base-${sha}-${key}.jsonl`);
}

/**
 * The rows of commit `sha`, from the cache or recorded in a temporary worktree that every exit
 * path removes. `record` runs in the worktree and returns its record text.
 * @param {{ root: string, sha: string, install: string, record?: (dir: string) => string }} options
 */
export function baseRows({ root, sha, install, record = recordFreshCheckout }) {
	const cached = join(root, cacheFile(sha, install));
	if (existsSync(cached)) return readFileSync(cached, 'utf8');
	const suites = git(root, ['ls-tree', '-r', '--name-only', sha, SUITES]);
	if (!/\.test\.ts$/m.test(suites)) {
		throw new BehaviorError(`behavior: ${sha.slice(0, 9)} has no behavior suites (${SUITES})`);
	}
	clearLeftovers(root);
	git(root, ['worktree', 'prune']);
	const dir = join(root, RESULTS, `worktree-${process.pid}`);
	let text;
	try {
		git(root, ['worktree', 'add', '--detach', dir, sha]);
		text = record(dir);
	} finally {
		removeWorktree(root, dir);
	}
	// A rename lands whole, so two runs at one commit can both write the cache.
	const temporary = `${cached}.${process.pid}`;
	mkdirSync(dirname(cached), { recursive: true });
	writeFileSync(temporary, text);
	renameSync(temporary, cached);
	return text;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Removes the worktrees of runs that are no longer alive. A live run's worktree is left alone.
 * @param {string} root
 */
export function clearLeftovers(root) {
	const results = join(root, RESULTS);
	if (!existsSync(results)) return;
	for (const name of readdirSync(results)) {
		const pid = Number(WORKTREE.exec(name)?.[1]);
		if (pid && (pid === process.pid || !isAlive(pid))) removeWorktree(root, join(results, name));
	}
}

/** @param {number} pid */
function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
	}
}

/**
 * Deletes a temporary worktree and its git registration, refusing when it holds a link: a
 * recursive delete through a junction would empty the install it points at.
 * @param {string} root
 * @param {string} dir
 */
export function removeWorktree(root, dir) {
	if (existsSync(dir)) {
		const links = lstatSync(dir).isSymbolicLink() ? [dir] : linksUnder(dir);
		if (links.length) {
			throw new BehaviorError(
				`behavior: refusing to remove ${dir}, these are links: ${links.join(', ')}`
			);
		}
		rmSync(dir, REMOVE);
	}
	git(root, ['worktree', 'prune']);
}

/** @param {string} dir @returns {string[]} */
export function linksUnder(dir) {
	const links = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (lstatSync(path).isSymbolicLink()) links.push(path);
		else if (entry.isDirectory()) links.push(...linksUnder(path));
	}
	return links;
}
