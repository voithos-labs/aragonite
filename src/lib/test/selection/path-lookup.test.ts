// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import {
	nextPath,
	previousPath,
	firstPath,
	lastPath,
	findBlockPathForElement
} from '../../selection/path-lookup';
import { nodeAt } from '../../tree-operations/node-ops';
import type { CstNode, Document } from '../../core/nodes';

function para(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

function bq(children: CstNode[]): CstNode {
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

describe('nodeAt', () => {
	it('resolves shallow and deep paths', () => {
		const d = doc([para('a\n'), bq([para('x\n')])]);
		expect((nodeAt(d, [0]) as CstNode).kind).toBe('paragraph');
		expect((nodeAt(d, [1]) as CstNode).kind).toBe('blockquote');
		expect((nodeAt(d, [1, 0]) as CstNode).kind).toBe('paragraph');
	});

	it('returns the document itself for the empty path', () => {
		const d = doc([para('a\n')]);
		expect(nodeAt(d, [])).toBe(d);
	});

	it('returns null for invalid paths', () => {
		const d = doc([para('a\n')]);
		expect(nodeAt(d, [5])).toBeNull();
		expect(nodeAt(d, [0, 0])).toBeNull();
	});
});

describe('nextPath', () => {
	it('moves between siblings at top level', () => {
		const d = doc([para('a\n'), para('b\n'), para('c\n')]);
		expect(nextPath(d, [0])).toEqual([1]);
		expect(nextPath(d, [1])).toEqual([2]);
		expect(nextPath(d, [2])).toBeNull();
	});

	it('enters a container as the next block', () => {
		const d = doc([para('a\n'), bq([para('x\n')])]);
		expect(nextPath(d, [0])).toEqual([1]);
		expect(nextPath(d, [1])).toEqual([1, 0]);
	});

	it('exits a container when at its last child', () => {
		const d = doc([bq([para('x\n')]), para('after\n')]);
		expect(nextPath(d, [0, 0])).toEqual([1]);
	});

	it('exits multiple nested containers when at the deepest last child', () => {
		const d = doc([bq([bq([para('x\n')])]), para('after\n')]);
		expect(nextPath(d, [0, 0, 0])).toEqual([1]);
	});

	it('returns null when already at the last block', () => {
		const d = doc([para('a\n'), bq([para('x\n')])]);
		expect(nextPath(d, [1, 0])).toBeNull();
	});
});

describe('previousPath', () => {
	it('moves backward at top level', () => {
		const d = doc([para('a\n'), para('b\n'), para('c\n')]);
		expect(previousPath(d, [1])).toEqual([0]);
		expect(previousPath(d, [0])).toBeNull();
	});

	it("enters a container's last descendant", () => {
		const d = doc([bq([para('x\n'), para('y\n')]), para('after\n')]);
		expect(previousPath(d, [1])).toEqual([0, 1]);
	});

	it('exits a container to its parent at the first child', () => {
		const d = doc([bq([para('x\n'), para('y\n')])]);
		expect(previousPath(d, [0, 0])).toEqual([0]);
		expect(previousPath(d, [0])).toBeNull();
	});

	it('steps to the container itself when at its first child', () => {
		const d = doc([para('a\n'), bq([para('x\n'), para('y\n')])]);
		expect(previousPath(d, [1, 0])).toEqual([1]);
		expect(previousPath(d, [1])).toEqual([0]);
	});
});

describe('firstPath / lastPath', () => {
	it('returns null for an empty document', () => {
		const d = doc([]);
		expect(firstPath(d)).toBeNull();
		expect(lastPath(d)).toBeNull();
	});

	it('returns the shallow first/last for flat documents', () => {
		const d = doc([para('a\n'), para('b\n'), para('c\n')]);
		expect(firstPath(d)).toEqual([0]);
		expect(lastPath(d)).toEqual([2]);
	});

	it('returns the deepest first descendant', () => {
		const d = doc([bq([para('a\n'), para('b\n')]), para('c\n')]);
		expect(firstPath(d)).toEqual([0, 0]);
	});

	it('returns the deepest last descendant', () => {
		const d = doc([para('a\n'), bq([para('b\n'), para('c\n')])]);
		expect(lastPath(d)).toEqual([1, 1]);
	});
});

describe('findBlockPathForElement', () => {
	it('reads data-block-path from the element itself', () => {
		const el = document.createElement('div');
		el.setAttribute('data-block-path', '[1,0]');
		expect(findBlockPathForElement(el)).toEqual([1, 0]);
	});

	it('walks ancestors to find the path', () => {
		const outer = document.createElement('div');
		outer.setAttribute('data-block-path', '[2]');
		const inner = document.createElement('span');
		outer.appendChild(inner);
		expect(findBlockPathForElement(inner)).toEqual([2]);
	});

	it('returns null when no ancestor carries the attribute', () => {
		const el = document.createElement('div');
		expect(findBlockPathForElement(el)).toBeNull();
	});

	it('returns null when the attribute is malformed JSON', () => {
		const el = document.createElement('div');
		el.setAttribute('data-block-path', 'not-json');
		expect(findBlockPathForElement(el)).toBeNull();
	});

	it('returns null when given a null element', () => {
		expect(findBlockPathForElement(null)).toBeNull();
	});
});
