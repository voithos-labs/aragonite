// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import {
	ensureListItemNewlineTerminated,
	spliceTerminatedItems
} from '$lib/tree-operations/list/terminator';
import { rebuildListRaw } from '$lib/schema/container-rebuilders';
import { checkStaleRaw } from '$lib/invariants/node-shape';
import type { CstNode } from '$lib/core/nodes';

describe('ensureListItemNewlineTerminated', () => {
	it('no-ops on an already terminated item', () => {
		const item = parse('- a\n').children[0].children![0];
		ensureListItemNewlineTerminated(item);
		expect(item.raw).toBe('- a\n');
	});

	it('appends directly to a childless raw', () => {
		const item: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- x',
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null }
		};
		ensureListItemNewlineTerminated(item);
		expect(item.raw).toBe('- x\n');
	});

	it('terminates the last child and rebuilds the item raw', () => {
		const item = parse('- a').children[0].children![0];
		expect(item.raw).toBe('- a');
		ensureListItemNewlineTerminated(item);
		expect(item.children![item.children!.length - 1].raw).toBe('a\n');
		expect(item.raw).toBe('- a\n');
	});

	// The last child may be a CONTAINER. Patching its raw without descending left
	// raw and children disagreeing (G1.1) the instant the item was terminated, and
	// the next rebuild of the nested list mashed its unterminated tail item into
	// the following one — three items serializing as two.
	it('descends into a nested container instead of patching its raw alone', () => {
		const item = parse('- a\n  - b').children[0].children![0];
		const nested = item.children![item.children!.length - 1];
		expect(nested.kind).toBe('list');

		ensureListItemNewlineTerminated(item);

		expect(checkStaleRaw(nested)).toBeNull();
		expect(item.raw).toBe('- a\n  - b\n');
	});

	it('leaves a terminated nested container able to take a following sibling item', () => {
		const item = parse('- a\n  - b').children[0].children![0];
		const nested = item.children![item.children!.length - 1];

		ensureListItemNewlineTerminated(item);
		spliceTerminatedItems(nested.children!, 1, 0, parse('- two\n').children[0].children!);
		rebuildListRaw(nested);

		expect(nested.children).toHaveLength(2);
		expect(nested.raw).toBe('- b\n- two\n');
	});
});

describe('spliceTerminatedItems', () => {
	it('terminates spliced items so the container rebuild keeps them on separate lines', () => {
		const list = parse('1. one\n2. two\n').children[0];
		const pasted = parse('6. Ordered\n7. third').children[0].children!;
		expect(pasted[pasted.length - 1].raw.endsWith('\n')).toBe(false);

		spliceTerminatedItems(list.children!, 1, 1, pasted);
		rebuildListRaw(list);

		expect(list.children!.length).toBe(3);
		expect(list.raw).toBe('1. one\n6. Ordered\n7. third\n');
	});

	it('passes non-listItems through untouched', () => {
		const children: CstNode[] = [];
		const para: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'no newline' };
		spliceTerminatedItems(children, 0, 0, [para]);
		expect(children).toEqual([para]);
		expect(para.raw).toBe('no newline');
	});
});
