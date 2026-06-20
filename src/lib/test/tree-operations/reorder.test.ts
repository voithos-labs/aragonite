import { describe, it, expect } from 'vitest';
import { reorderChildren, reorderChildrenWithTrivia } from '$lib/editor/tree-operations/reorder';
import { createSharingState } from '$lib/editor/undo/epoch-tracker';

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
		const change = reorderChildren(children, 3, 0); // d to front
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
});

describe('reorderChildrenWithTrivia', () => {
	const sharing = () => createSharingState();

	it('keeps separators on the slot when a node moves to the front', () => {
		// First slot has no separator; the rest each carry a leading blank line.
		const children = [triviaNode('', 'a\n'), triviaNode('\n', 'b\n'), triviaNode('\n', 'c\n')];
		reorderChildrenWithTrivia(children, 2, 0, sharing()); // c to front

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
		s.markSnapshotTaken(); // children predate the epoch → shared

		reorderChildrenWithTrivia(children, 0, 1, s);

		// The shared originals keep their pre-move trivia; the working array holds copies.
		expect(originals.map((c) => c.leadingTrivia)).toEqual(['', '\n']);
		expect(children.every((c) => !originals.includes(c))).toBe(true);
		expect(children.map((c) => c.leadingTrivia)).toEqual(['', '\n']);
	});
});
