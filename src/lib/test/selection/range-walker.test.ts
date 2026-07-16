import { describe, it, expect } from 'vitest';
import { walkBetween } from '../../selection/primitives';
import type { CstNode, Document } from '../../core/nodes';

function para(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

function blockquote(children: CstNode[]): CstNode {
	return {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '',
		metadata: { quoteDepth: 1 },
		children,
		innerPrefix: '',
		innerSuffix: ''
	};
}

function doc(children: CstNode[]): Document {
	return { kind: 'document', prefix: '', children, suffix: '' };
}

describe('walkBetween', () => {
	it('yields nothing for adjacent siblings at top level', () => {
		const d = doc([para('a\n'), para('b\n')]);
		expect(walkBetween(d, [0], [1])).toEqual([]);
	});

	it('yields middle siblings at top level', () => {
		const d = doc([para('a\n'), para('b\n'), para('c\n'), para('d\n')]);
		expect(walkBetween(d, [0], [3])).toEqual([[1], [2]]);
	});

	it('walks into a container between start and end', () => {
		const d = doc([para('a\n'), blockquote([para('b1\n'), para('b2\n')]), para('c\n')]);
		expect(walkBetween(d, [0], [2])).toEqual([[1], [1, 0], [1, 1]]);
	});

	it('yields paths from start inside a container to end outside', () => {
		const d = doc([blockquote([para('x\n'), para('y\n'), para('z\n')]), para('after\n')]);
		expect(walkBetween(d, [0, 1], [1])).toEqual([[0, 2]]);
	});

	it('yields paths across nested containers', () => {
		const d = doc([
			para('a\n'),
			blockquote([blockquote([para('i\n'), para('j\n')]), para('k\n')]),
			para('b\n')
		]);
		expect(walkBetween(d, [0], [2])).toEqual([[1], [1, 0], [1, 0, 0], [1, 0, 1], [1, 1]]);
	});
});
