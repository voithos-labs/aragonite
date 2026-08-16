import { describe, it, expect } from 'vitest';
import {
	applyStructuralChangeToIdsRefs,
	changeBetweenIds,
	trackChildIds
} from '$lib/tree-operations/structural-change';
import { parse } from '$lib/core/parser';
import { deleteAtPath } from '$lib/tree-operations/path-mutate';
import { createSharingState } from '$lib/tree-operations/sharing';
import type { BlockComponent } from '$lib/block-component';

// The composer a caller running several splice doors reports with: the doors write their net
// splice into the id array, and one contiguous window is read back off slot identity.

describe('changeBetweenIds', () => {
	it('reports noop when no slot moved', () => {
		expect(changeBetweenIds(['a', 'b'], ['a', 'b'])).toEqual({ op: 'noop' });
	});

	it('narrows to the slots that moved, leaving matching ends outside the window', () => {
		expect(changeBetweenIds(['a', 'b', 'c'], ['a', 'c'])).toEqual({
			op: 'delete',
			at: 1,
			count: 1
		});
		expect(changeBetweenIds(['a', 'c'], ['a', 'b', 'c'])).toEqual({
			op: 'insert',
			at: 1,
			count: 1
		});
	});

	it('maps every marker surviving inside the window to where it stood', () => {
		// A reorder inside the window: both slots survive, neither where it started.
		expect(changeBetweenIds(['a', 'b', 'c', 'd'], ['a', 'c', 'b', 'd'])).toEqual({
			op: 'replace',
			at: 1,
			count: 2,
			newCount: 2,
			idMap: { 0: 1, 1: 0 }
		});
	});

	it('leaves a slot the splice merely shifted outside the window', () => {
		// `d` and `e` moved up by one, which the window's own splice already carries.
		expect(changeBetweenIds(['a', 'b', 'c', 'd', 'e'], ['a', 'x', 'd', 'e'])).toEqual({
			op: 'replace',
			at: 1,
			count: 2,
			newCount: 1,
			idMap: {}
		});
	});

	it('reports the whole array when both ends moved', () => {
		expect(changeBetweenIds(['a', 'b'], ['x', 'y', 'z'])).toEqual({
			op: 'replace',
			at: 0,
			count: 2,
			newCount: 3,
			idMap: {}
		});
	});

	it('empties an array and fills an empty one', () => {
		expect(changeBetweenIds(['a', 'b'], [])).toEqual({ op: 'delete', at: 0, count: 2 });
		expect(changeBetweenIds([], ['a'])).toEqual({ op: 'insert', at: 0, count: 1 });
	});

	// A repeated marker would make the window ambiguous; ids are unique per slot by construction,
	// and the composer must not silently map a duplicate to the wrong origin.
	it('leaves ids and children in lockstep for the shape a settle fold produces', () => {
		const change = changeBetweenIds(['a', 'b', 'c', 'd'], ['a']);
		const ids = ['id-0', 'id-1', 'id-2', 'id-3'];
		applyStructuralChangeToIdsRefs(change, ids, new Array<BlockComponent | undefined>(4));
		expect(ids).toEqual(['id-0']);
	});
});

describe('trackChildIds', () => {
	it('adds up the splices a ceremony makes through several doors', () => {
		const doc = parse('a\n\nb\n\nc\n\nd\n');
		const ledger = trackChildIds(doc);
		const sharing = createSharingState();

		deleteAtPath(doc, [2], sharing);
		deleteAtPath(doc, [1], sharing);

		expect(ledger.read()).toEqual({ op: 'delete', at: 1, count: 2 });
	});

	it('gives the borrowed slot back to a parent that kept no id array', () => {
		const doc = parse('a\n\nb\n');
		const ledger = trackChildIds(doc);
		expect(doc.childIds).toHaveLength(2);
		ledger.release();
		expect(doc.childIds).toBeUndefined();
	});

	it('keeps an array the parent already had', () => {
		const doc = parse('> a\n> b\n');
		const quote = doc.children[0];
		quote.childIds = ['q0'];
		const ledger = trackChildIds(quote);
		ledger.release();
		expect(quote.childIds).toEqual(['q0']);
	});
});
