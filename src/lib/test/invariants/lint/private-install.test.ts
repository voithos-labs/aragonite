/**
 * The consumer smoke's install step must not write through a worktree's linked node_modules.
 * Miss-analysis: the smoke script had no test, so deleting through the link went unseen until it emptied the shared install.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withPrivateInstall } from '../../../../../scripts/smoke/private-install.mjs';

let root: string;
let shared: string;
let linked: string;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'private-install-'));
	shared = path.join(root, 'shared');
	mkdirSync(path.join(shared, 'pkg'), { recursive: true });
	writeFileSync(path.join(shared, 'pkg', 'package.json'), '{}');
	mkdirSync(path.join(root, 'wt'));
	linked = path.join(root, 'wt', 'node_modules');
	symlinkSync(shared, linked, 'junction');
});

afterEach(() => {
	if (lstatSync(linked, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(linked);
	rmSync(root, { recursive: true, force: true });
});

// What the smoke does inside the install: drop the package, then install afresh.
const reinstall = () => {
	rmSync(path.join(linked, 'pkg'), { recursive: true, force: true });
	mkdirSync(path.join(linked, 'pkg'), { recursive: true });
	writeFileSync(path.join(linked, 'pkg', 'private.txt'), 'x');
};

describe('withPrivateInstall', () => {
	it('leaves a linked install untouched and puts the link back', () => {
		withPrivateInstall(linked, reinstall);
		expect(existsSync(path.join(shared, 'pkg', 'package.json'))).toBe(true);
		expect(existsSync(path.join(shared, 'pkg', 'private.txt'))).toBe(false);
		expect(lstatSync(linked).isSymbolicLink()).toBe(true);
		expect(path.resolve(readlinkSync(linked))).toBe(path.resolve(shared));
	});

	it('puts the link back when the run throws', () => {
		expect(() =>
			withPrivateInstall(linked, () => {
				reinstall();
				throw new Error('build failed');
			})
		).toThrow('build failed');
		expect(lstatSync(linked).isSymbolicLink()).toBe(true);
		expect(existsSync(path.join(shared, 'pkg', 'package.json'))).toBe(true);
	});

	it('runs in place on a plain directory and keeps what the run wrote', () => {
		unlinkSync(linked);
		mkdirSync(linked);
		withPrivateInstall(linked, reinstall);
		expect(lstatSync(linked).isSymbolicLink()).toBe(false);
		expect(existsSync(path.join(linked, 'pkg', 'private.txt'))).toBe(true);
	});
});
