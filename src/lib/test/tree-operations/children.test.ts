import { describe, it, expect } from 'vitest';
import { pushChild, spliceChildren } from '../../tree-operations/children';
import type { CstNode } from '../../core/nodes';

function para(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

function bq(children: CstNode[], childIds?: string[]): CstNode {
	return {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '',
		metadata: { quoteDepth: 1 },
		children,
		childIds,
		innerPrefix: '',
		innerSuffix: ''
	};
}

describe('pushChild', () => {
	it('appends to children and childIds in lockstep', () => {
		const c = bq([para('a\n')], ['id-a']);
		pushChild(c, para('b\n'));
		expect(c.children).toHaveLength(2);
		expect(c.childIds).toHaveLength(2);
		expect(c.childIds![0]).toBe('id-a');
	});

	it('lazy-inits childIds to cover existing children before appending', () => {
		const c = bq([para('a\n'), para('b\n')]);
		pushChild(c, para('c\n'));
		expect(c.children).toHaveLength(3);
		expect(c.childIds).toHaveLength(3);
		expect(new Set(c.childIds).size).toBe(3);
	});
});

describe('spliceChildren', () => {
	it.each([
		['insert', 1, 0, 2],
		['replace', 0, 1, 1],
		['delete', 1, 1, 0]
	] as const)('%s keeps childIds aligned with children', (_label, at, removeCount, itemCount) => {
		const c = bq([para('a\n'), para('b\n')], ['id-a', 'id-b']);
		const items = Array.from({ length: itemCount }, (_, i) => para(`n${i}\n`));
		spliceChildren(c, at, removeCount, ...items);
		expect(c.children).toHaveLength(2 - removeCount + itemCount);
		expect(c.childIds).toHaveLength(c.children!.length);
	});

	it('preserves survivor ids and fabricates fresh ids for inserted items', () => {
		const c = bq([para('a\n'), para('b\n'), para('c\n')], ['id-a', 'id-b', 'id-c']);
		spliceChildren(c, 1, 1, para('x\n'));
		expect(c.childIds![0]).toBe('id-a');
		expect(c.childIds![2]).toBe('id-c');
		expect(c.childIds![1]).not.toBe('id-b');
	});

	it('leaves childIds absent on a container that has none', () => {
		const c = bq([para('a\n'), para('b\n')]);
		spliceChildren(c, 0, 1);
		expect(c.children).toHaveLength(1);
		expect(c.childIds).toBeUndefined();
	});
});
