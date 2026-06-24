import { describe, it, expect } from 'vitest';
import type { StructuralChange } from '$lib/tree-operations/structural-change';

describe('StructuralChange — type shape', () => {
	it('accepts all four variants including replace with idMap', () => {
		const noop: StructuralChange = { op: 'noop' };
		const ins: StructuralChange = { op: 'insert', at: 1, count: 2 };
		const del: StructuralChange = { op: 'delete', at: 0, count: 1 };
		const rep: StructuralChange = { op: 'replace', at: 3, count: 1, newCount: 4 };
		const repWithMap: StructuralChange = {
			op: 'replace',
			at: 0,
			count: 1,
			newCount: 2,
			idMap: { 0: 0 }
		};
		expect([noop.op, ins.op, del.op, rep.op, repWithMap.op]).toEqual([
			'noop',
			'insert',
			'delete',
			'replace',
			'replace'
		]);
	});
});
