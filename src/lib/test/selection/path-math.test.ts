import { describe, it, expect } from 'vitest';
import {
	pathHasPrefix,
	isStrictAncestorOf,
	pathsEqual,
	sharedPrefixLength,
	isPathBetween,
	asDocPath
} from '../../selection/path-math';
import { extendDocPath, docPathFrom } from '../../cursor/coordinate-spaces';
import { checkCommitPathAddressable } from '../../invariants/commit-paths';

describe('pathHasPrefix', () => {
	it('returns true when prefix equals path', () => {
		expect(pathHasPrefix([1, 2], [1, 2])).toBe(true);
		expect(pathHasPrefix([], [])).toBe(true);
	});

	it('returns true when prefix is a strict ancestor', () => {
		expect(pathHasPrefix([1, 2, 3], [1, 2])).toBe(true);
		expect(pathHasPrefix([0], [])).toBe(true);
	});

	it('returns false when prefix is longer than path', () => {
		expect(pathHasPrefix([1], [1, 2])).toBe(false);
	});

	it('returns false on first index mismatch', () => {
		expect(pathHasPrefix([1, 3], [1, 2])).toBe(false);
		expect(pathHasPrefix([2], [1])).toBe(false);
	});
});

describe('isStrictAncestorOf', () => {
	it('returns true when ancestor is strict prefix of descendant', () => {
		expect(isStrictAncestorOf([1], [1, 2])).toBe(true);
		expect(isStrictAncestorOf([], [0])).toBe(true);
	});

	it('returns false on equal paths', () => {
		expect(isStrictAncestorOf([1, 2], [1, 2])).toBe(false);
		expect(isStrictAncestorOf([], [])).toBe(false);
	});

	it('returns false when ancestor is longer than descendant', () => {
		expect(isStrictAncestorOf([1, 2], [1])).toBe(false);
	});

	it('returns false when paths diverge', () => {
		expect(isStrictAncestorOf([1], [2, 0])).toBe(false);
	});
});

describe('pathsEqual', () => {
	it('returns true for value-equal paths', () => {
		expect(pathsEqual([1, 2, 3], [1, 2, 3])).toBe(true);
		expect(pathsEqual([], [])).toBe(true);
	});

	it('returns false on length mismatch', () => {
		expect(pathsEqual([1, 2], [1, 2, 0])).toBe(false);
		expect(pathsEqual([1], [])).toBe(false);
	});

	it('returns false on element mismatch', () => {
		expect(pathsEqual([1, 2], [1, 3])).toBe(false);
	});
});

describe('sharedPrefixLength', () => {
	it('returns 0 when first elements differ', () => {
		expect(sharedPrefixLength([1], [2])).toBe(0);
		expect(sharedPrefixLength([1, 2], [3, 2])).toBe(0);
	});

	it('returns the count of shared leading indices', () => {
		expect(sharedPrefixLength([1, 2, 3], [1, 2, 9])).toBe(2);
		expect(sharedPrefixLength([1, 2], [1, 2, 3])).toBe(2);
	});

	it('returns 0 for empty inputs', () => {
		expect(sharedPrefixLength([], [1, 2])).toBe(0);
		expect(sharedPrefixLength([1, 2], [])).toBe(0);
	});
});

describe('isPathBetween', () => {
	it('returns true strictly between two paths', () => {
		expect(isPathBetween([1], [0], [2])).toBe(true);
		expect(isPathBetween([1, 0], [0], [2])).toBe(true);
		expect(isPathBetween([0, 1], [0, 0], [0, 2])).toBe(true);
	});

	it('returns false at or outside the boundaries', () => {
		expect(isPathBetween([0], [0], [2])).toBe(false);
		expect(isPathBetween([2], [0], [2])).toBe(false);
		expect(isPathBetween([3], [0], [2])).toBe(false);
	});
});

describe('DocPath brand', () => {
	// Assignment-shaped compile pin (runtime-free): the doc-absolute guard demands a minted DocPath,
	// and an unused @ts-expect-error is itself a check error, so a green gate proves all three mints.
	it('the commit-path guard rejects an unminted path but accepts every mint', () => {
		type GuardPath = Parameters<typeof checkCommitPathAddressable>[1];

		// @ts-expect-error a plain number[] is not a doc-absolute path
		const bare: GuardPath = [0];
		void bare;

		const minted: GuardPath = asDocPath([0]);
		const extended: GuardPath = extendDocPath([0], 1);
		const composed: GuardPath = docPathFrom([0, 1]);
		expect(minted).toEqual([0]);
		expect(extended).toEqual([0, 1]);
		expect(composed).toEqual([0, 1]);
	});
});
