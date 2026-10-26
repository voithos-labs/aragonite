/** The behavior differential's base: which commit `--against` names, what keys its cached record,
 *  and that its temporary worktree goes on every exit without a delete through a link. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	SUITES,
	baseRows,
	cacheFile,
	clearLeftovers,
	resolveAgainst
} from '../../../../../scripts/behavior-base.mjs';

let root: string;
const git = (...args: string[]) =>
	execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

/** Commits `files` on the current branch and returns the commit's sha. */
function commit(files: Record<string, string>): string {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(root, path, '..'), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	git('add', '-A');
	git('commit', '-q', '-m', 'step');
	return git('rev-parse', 'HEAD');
}

const withSuites = { [`${SUITES}/keys.test.ts`]: 'keys' };
const worktrees = () => git('worktree', 'list').split('\n').length;
const worktreeOf = (pid: number) => join(root, 'behavior-results', `worktree-${pid}`);
const recordFails = () => {
	throw new Error('the suites failed');
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'behavior-base-'));
	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'test');
	git('config', 'commit.gpgsign', 'false');
	writeFileSync(join(root, '.gitignore'), 'behavior-results/\n');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('behavior: what --against names', () => {
	it('reads a ref as its commit and a path as a record file', () => {
		const sha = commit(withSuites);
		git('branch', 'base');
		expect(resolveAgainst('base', root)).toMatchObject({ sha });
		const record = join(root, 'rows.jsonl');
		writeFileSync(record, '');
		expect(resolveAgainst(record, root)).toEqual({ file: record, label: record });
	});

	it('fails in one line on a name that is neither', () => {
		commit(withSuites);
		expect(() => resolveAgainst('no-such-ref', root)).toThrow(
			'behavior: no-such-ref is neither a record file nor a commit'
		);
	});

	it('defaults to where HEAD left dev, and names it', () => {
		const start = commit(withSuites);
		git('branch', 'dev');
		commit({ 'later.txt': 'later' });
		const base = resolveAgainst(null, root);
		expect(base).toMatchObject({ sha: start });
		expect(base.label).toContain('merge-base HEAD dev');
	});

	it('fails with the usage line when there is no dev to default to', () => {
		commit(withSuites);
		expect(() => resolveAgainst(null, root)).toThrow(/usage: npm run behavior -- --against/);
	});
});

describe('behavior: the base record', () => {
	it.each([
		['no behavior folder', { 'readme.txt': 'old' }],
		['a behavior folder of helpers only', { [`${SUITES}/rows.ts`]: 'helpers' }]
	])('refuses a commit with %s before making a worktree', (_, files) => {
		const sha = commit(files);
		let recorded = false;
		const record = () => ((recorded = true), '');
		expect(() => baseRows({ root, sha, install: 'i', record })).toThrow(/has no behavior suites/);
		expect(recorded).toBe(false);
		expect(worktrees()).toBe(1);
	});

	it('records the commit in a worktree, removes it, and serves the next run from the cache', () => {
		const sha = commit(withSuites);
		commit({ [`${SUITES}/keys.test.ts`]: 'changed after the base' });
		const record = (dir: string) => readFileSync(join(dir, SUITES, 'keys.test.ts'), 'utf8');
		expect(baseRows({ root, sha, install: 'i', record })).toBe('keys');
		expect(existsSync(worktreeOf(process.pid))).toBe(false);
		expect(worktrees()).toBe(1);
		expect(baseRows({ root, sha, install: 'i', record: recordFails })).toBe('keys');
	});

	it('keys the cache on the commit and the install', () => {
		expect(cacheFile('a', 'i')).toBe(cacheFile('a', 'i'));
		expect(cacheFile('a', 'i')).not.toBe(cacheFile('b', 'i'));
		expect(cacheFile('a', 'i')).not.toBe(cacheFile('a', 'reinstalled'));
	});

	it('removes the worktree when the suites fail', () => {
		const sha = commit(withSuites);
		expect(() => baseRows({ root, sha, install: 'i', record: recordFails })).toThrow(
			'the suites failed'
		);
		expect(existsSync(worktreeOf(process.pid))).toBe(false);
		expect(worktrees()).toBe(1);
		expect(existsSync(join(root, cacheFile(sha, 'i')))).toBe(false);
	});

	it('refuses to delete a worktree holding a link, and leaves what it points at', () => {
		const sha = commit(withSuites);
		const outside = mkdtempSync(join(tmpdir(), 'behavior-install-'));
		writeFileSync(join(outside, 'kept.txt'), 'kept');
		let link = '';
		const record = (dir: string) => {
			link = join(dir, 'node_modules');
			symlinkSync(outside, link, 'junction');
			return '';
		};
		try {
			expect(() => baseRows({ root, sha, install: 'i', record })).toThrow(/refusing to remove/);
			expect(existsSync(join(outside, 'kept.txt'))).toBe(true);
			expect(existsSync(worktreeOf(process.pid))).toBe(true);
		} finally {
			if (link) unlinkSync(link);
			rmSync(outside, { recursive: true, force: true });
		}
	});
});

describe('behavior: worktrees left by other runs', () => {
	it('clears a dead run’s worktree and leaves a live run’s alone', () => {
		const dead = spawnSync(process.execPath, ['-e', '']).pid;
		const live = process.ppid;
		for (const pid of [dead, live]) mkdirSync(worktreeOf(pid), { recursive: true });
		clearLeftovers(root);
		expect(existsSync(worktreeOf(dead))).toBe(false);
		expect(existsSync(worktreeOf(live))).toBe(true);
	});

	it('refuses to clear a dead run’s folder that is itself a link', () => {
		const dead = spawnSync(process.execPath, ['-e', '']).pid;
		const outside = mkdtempSync(join(tmpdir(), 'behavior-install-'));
		writeFileSync(join(outside, 'kept.txt'), 'kept');
		mkdirSync(join(root, 'behavior-results'));
		symlinkSync(outside, worktreeOf(dead), 'junction');
		try {
			expect(() => clearLeftovers(root)).toThrow(/refusing to remove/);
			expect(existsSync(join(outside, 'kept.txt'))).toBe(true);
		} finally {
			if (existsSync(worktreeOf(dead))) unlinkSync(worktreeOf(dead));
			rmSync(outside, { recursive: true, force: true });
		}
	});
});
