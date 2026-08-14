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
		ensureListItemNewlineTerminated(item, '\n');
		expect(item.raw).toBe('- a\n');
	});

	it('appends directly to a childless raw', () => {
		const item: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- x',
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null }
		};
		ensureListItemNewlineTerminated(item, '\n');
		expect(item.raw).toBe('- x\n');
	});

	it('terminates the last child and rebuilds the item raw', () => {
		const item = parse('- a').children[0].children![0];
		expect(item.raw).toBe('- a');
		ensureListItemNewlineTerminated(item, '\n');
		expect(item.children![item.children!.length - 1].raw).toBe('a\n');
		expect(item.raw).toBe('- a\n');
	});

	// Patching a CONTAINER last child's raw without descending leaves raw and children
	// disagreeing (G1.1), and the next rebuild mashes its tail item into the following one.
	it('descends into a nested container instead of patching its raw alone', () => {
		const item = parse('- a\n  - b').children[0].children![0];
		const nested = item.children![item.children!.length - 1];
		expect(nested.kind).toBe('list');

		ensureListItemNewlineTerminated(item, '\n');

		expect(checkStaleRaw(nested)).toBeNull();
		expect(item.raw).toBe('- a\n  - b\n');
	});

	// The descent stops above a node whose children are not whole lines: a grid cell's bytes sit
	// inside the row's line, so an ending appended there splits the row and corrupts the table.
	// Miss-analysis: every descent case ended in a prose leaf or a strip container, so the arm
	// reaching a kind whose raw is not a line of its own was never driven.
	it('stops above a grid cell rather than splitting the row', () => {
		const source = '- | a | b |\n  | --- | --- |\n  | c | d |';
		const item = parse(source).children[0].children![0];
		expect(item.children![item.children!.length - 1].kind).toBe('table');

		ensureListItemNewlineTerminated(item, '\n');

		expect(item.raw).toBe(source + '\n');
		expect(checkStaleRaw(item)).toBeNull();
	});

	it('leaves a terminated nested container able to take a following sibling item', () => {
		const item = parse('- a\n  - b').children[0].children![0];
		const nested = item.children![item.children!.length - 1];

		ensureListItemNewlineTerminated(item, '\n');
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

	// A literal '\n' strands an item arriving WITHOUT an ending as an LF line inside a CRLF
	// container (G4.20); the siblings it joins carry the only ending it can adopt.
	it('adopts the surrounding list ending instead of a literal LF', () => {
		const list = parse('1. one\r\n2. two\r\n').children[0];
		const pasted = parse('6. Ordered\r\n7. third').children[0].children!;

		spliceTerminatedItems(list.children!, 1, 1, pasted);
		rebuildListRaw(list);

		expect(pasted[pasted.length - 1].raw.endsWith('\r\n')).toBe(true);
		expect(list.raw).not.toMatch(/[^\r]\n/);
	});

	it('keeps LF items on LF when the list is LF', () => {
		const list = parse('1. one\n2. two\n').children[0];
		const pasted = parse('6. Ordered\n7. third').children[0].children!;

		spliceTerminatedItems(list.children!, 1, 1, pasted);

		expect(pasted[pasted.length - 1].raw.endsWith('\n')).toBe(true);
		expect(pasted[pasted.length - 1].raw.endsWith('\r\n')).toBe(false);
	});

	it('passes non-listItems through untouched', () => {
		const children: CstNode[] = [];
		const para: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'no newline' };
		spliceTerminatedItems(children, 0, 0, [para]);
		expect(children).toEqual([para]);
		expect(para.raw).toBe('no newline');
	});
});
