import { describe, it, expect } from 'vitest';
import { reorderChildren, reorderChildrenWithTrivia } from '$lib/tree-operations/reorder';
import { createSharingState } from '$lib/tree-operations/sharing';
import { takeDevWarns } from '../support/warn-gate';

const node = (raw: string) => ({ kind: 'paragraph', raw }) as any;
const triviaNode = (leadingTrivia: string, raw: string) =>
	({ kind: 'paragraph', leadingTrivia, raw }) as any;

describe('reorderChildren', () => {
	it('moves down by one and returns a permutation replace', () => {
		const children = [node('a'), node('b'), node('c'), node('d')];
		const change = reorderChildren(children, 1, 2);
		expect(children.map((c) => c.raw)).toEqual(['a', 'c', 'b', 'd']);
		expect(change).toEqual({ op: 'replace', at: 1, count: 2, newCount: 2, idMap: { 0: 1, 1: 0 } });
	});

	it('moves up across a gap with a full-window permutation', () => {
		const children = [node('a'), node('b'), node('c'), node('d')];
		const change = reorderChildren(children, 3, 0);
		expect(children.map((c) => c.raw)).toEqual(['d', 'a', 'b', 'c']);
		expect(change).toEqual({
			op: 'replace',
			at: 0,
			count: 4,
			newCount: 4,
			idMap: { 0: 3, 1: 0, 2: 1, 3: 2 }
		});
	});

	it('is a noop when from === to', () => {
		const children = [node('a'), node('b')];
		expect(reorderChildren(children, 1, 1)).toEqual({ op: 'noop' });
		expect(children.map((c) => c.raw)).toEqual(['a', 'b']);
	});

	// A stale `from` (a mid-drag delete shrinking the table) must never splice `undefined`
	// into the $state tree.
	it('is a guarded noop when `from` is out of bounds', () => {
		const children = [node('a'), node('b')];
		expect(reorderChildren(children, 5, 0)).toEqual({ op: 'noop' });
		expect(children.map((c) => c.raw)).toEqual(['a', 'b']);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['reorder']);
	});

	it('is a guarded noop when `to` is out of bounds', () => {
		const children = [node('a'), node('b')];
		expect(reorderChildren(children, 0, 9)).toEqual({ op: 'noop' });
		expect(children.map((c) => c.raw)).toEqual(['a', 'b']);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['reorder']);
	});
});

describe('reorderChildrenWithTrivia', () => {
	const sharing = () => createSharingState();

	it('keeps separators on the slot when a node moves to the front', () => {
		const children = [triviaNode('', 'a\n'), triviaNode('\n', 'b\n'), triviaNode('\n', 'c\n')];
		reorderChildrenWithTrivia(children, 2, 0, sharing());

		expect(children.map((c) => c.raw)).toEqual(['c\n', 'a\n', 'b\n']);
		expect(children.map((c) => c.leadingTrivia)).toEqual(['', '\n', '\n']);
	});

	it('returns the same permutation idMap as reorderChildren', () => {
		const children = [triviaNode('', 'a\n'), triviaNode('\n', 'b\n'), triviaNode('\n', 'c\n')];
		const change = reorderChildrenWithTrivia(children, 0, 2, sharing());
		expect(change).toEqual({
			op: 'replace',
			at: 0,
			count: 3,
			newCount: 3,
			idMap: { 0: 1, 1: 2, 2: 0 }
		});
	});

	it('copies shared nodes before writing trivia (copy-path-on-write)', () => {
		const children = [triviaNode('', 'a\n'), triviaNode('\n', 'b\n')];
		const originals = children.slice();
		const s = sharing();
		s.markSnapshotTaken();

		reorderChildrenWithTrivia(children, 0, 1, s);

		expect(originals.map((c) => c.leadingTrivia)).toEqual(['', '\n']);
		expect(children.every((c) => !originals.includes(c))).toBe(true);
		expect(children.map((c) => c.leadingTrivia)).toEqual(['', '\n']);
	});

	// The OOB backstop must fire BEFORE the per-slot unshare loop, or a stale index reads
	// `.leadingTrivia` off `undefined` and throws before the delegated guard can no-op.
	it('is a guarded noop when `from` is out of bounds, before any unshare', () => {
		const children = [triviaNode('', 'a\n'), triviaNode('\n', 'b\n')];
		const originals = children.slice();
		const s = sharing();
		s.markSnapshotTaken();

		expect(reorderChildrenWithTrivia(children, 5, 0, s)).toEqual({ op: 'noop' });
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['reorder']);
		expect(children.map((c) => c.raw)).toEqual(['a\n', 'b\n']);
		expect(children.every((c, i) => c === originals[i])).toBe(true);
	});

	it('is a guarded noop when `to` is out of bounds', () => {
		const children = [triviaNode('', 'a\n'), triviaNode('\n', 'b\n')];
		expect(reorderChildrenWithTrivia(children, 0, 9, sharing())).toEqual({ op: 'noop' });
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['reorder']);
		expect(children.map((c) => c.raw)).toEqual(['a\n', 'b\n']);
	});
});
