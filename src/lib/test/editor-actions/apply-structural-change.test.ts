import { describe, it, expect } from 'vitest';
import { applyStructuralChangeToIdsRefs } from '$lib/editor/editor-actions/undo-controller';
import type { BlockComponent } from '$lib/editor/contracts';

function mockRef(): BlockComponent {
	return {
		focus: () => {},
		getCursorOffset: () => null,
		editable: true,
		focusable: true
	} as BlockComponent;
}

describe('applyStructuralChangeToIdsRefs', () => {
	describe('noop', () => {
		it('leaves ids and refs unchanged', () => {
			const ids = ['a', 'b', 'c'];
			const refs = [mockRef(), mockRef(), mockRef()];
			applyStructuralChangeToIdsRefs({ op: 'noop' }, ids, refs);
			expect(ids).toEqual(['a', 'b', 'c']);
			expect(refs).toHaveLength(3);
		});
	});

	describe('insert', () => {
		it('inserts fresh ids and undefined refs at position', () => {
			const ids = ['a', 'b', 'c'];
			const refs = [mockRef(), mockRef(), mockRef()];
			applyStructuralChangeToIdsRefs({ op: 'insert', at: 1, count: 2 }, ids, refs);
			expect(ids).toHaveLength(5);
			expect(ids[0]).toBe('a');
			expect(ids[3]).toBe('b');
			expect(ids[4]).toBe('c');
			expect(ids[1]).toBeTruthy();
			expect(ids[2]).toBeTruthy();
			expect(ids[1]).not.toBe(ids[2]);
			expect(refs[1]).toBeUndefined();
			expect(refs[2]).toBeUndefined();
			expect(refs).toHaveLength(5);
		});

		it('inserts at position 0', () => {
			const ids = ['x'];
			const refs = [mockRef()];
			applyStructuralChangeToIdsRefs({ op: 'insert', at: 0, count: 1 }, ids, refs);
			expect(ids).toHaveLength(2);
			expect(ids[1]).toBe('x');
			expect(refs[0]).toBeUndefined();
		});

		it('inserts at end (at === length)', () => {
			const ids = ['x'];
			const refs = [mockRef()];
			applyStructuralChangeToIdsRefs({ op: 'insert', at: 1, count: 1 }, ids, refs);
			expect(ids).toHaveLength(2);
			expect(ids[0]).toBe('x');
		});
	});

	describe('delete', () => {
		it('removes count items at position', () => {
			const ids = ['a', 'b', 'c', 'd'];
			const refs = [mockRef(), mockRef(), mockRef(), mockRef()];
			applyStructuralChangeToIdsRefs({ op: 'delete', at: 1, count: 2 }, ids, refs);
			expect(ids).toEqual(['a', 'd']);
			expect(refs).toHaveLength(2);
		});
	});

	describe('replace without idMap', () => {
		it('replaces range with fresh ids and undefined refs', () => {
			const ids = ['a', 'b', 'c'];
			const refs = [mockRef(), mockRef(), mockRef()];
			applyStructuralChangeToIdsRefs({ op: 'replace', at: 1, count: 1, newCount: 2 }, ids, refs);
			expect(ids).toHaveLength(4);
			expect(ids[0]).toBe('a');
			expect(ids[3]).toBe('c');
			expect(ids[1]).not.toBe('b');
			expect(ids[2]).not.toBe('b');
			expect(ids[1]).not.toBe(ids[2]);
			expect(refs[1]).toBeUndefined();
			expect(refs[2]).toBeUndefined();
		});
	});

	describe('replace with idMap (split: new[0] inherits old[0])', () => {
		it('preserves old id and ref at mapped new position', () => {
			const ids = ['original', 'b'];
			const originalRef = mockRef();
			const refs = [originalRef, mockRef()];
			applyStructuralChangeToIdsRefs(
				{ op: 'replace', at: 0, count: 1, newCount: 2, idMap: { 0: 0 } },
				ids,
				refs
			);
			expect(ids).toHaveLength(3);
			expect(ids[0]).toBe('original');
			expect(ids[1]).not.toBe('original');
			expect(ids[2]).toBe('b');
			expect(refs[0]).toBe(originalRef);
			expect(refs[1]).toBeUndefined();
		});
	});

	describe('replace with idMap (merge-prev: new[0] inherits first of two replaced)', () => {
		it('merged block inherits the first replaced id', () => {
			const ids = ['prev', 'curr', 'next'];
			const prevRef = mockRef();
			const refs = [prevRef, mockRef(), mockRef()];
			applyStructuralChangeToIdsRefs(
				{ op: 'replace', at: 0, count: 2, newCount: 1, idMap: { 0: 0 } },
				ids,
				refs
			);
			expect(ids).toEqual(['prev', 'next']);
			expect(refs[0]).toBe(prevRef);
		});
	});

	describe('replace with idMap (merge-next: at=blockIndex keeps current id)', () => {
		it('merged block inherits the first of the two replaced ids', () => {
			const ids = ['a', 'curr', 'next'];
			const currRef = mockRef();
			const refs = [mockRef(), currRef, mockRef()];
			applyStructuralChangeToIdsRefs(
				{ op: 'replace', at: 1, count: 2, newCount: 1, idMap: { 0: 0 } },
				ids,
				refs
			);
			expect(ids).toEqual(['a', 'curr']);
			expect(refs[1]).toBe(currRef);
		});
	});

	describe('replace degenerate cases', () => {
		it('replace with count=0 behaves like insert', () => {
			const ids = ['a', 'b'];
			const refs = [mockRef(), mockRef()];
			applyStructuralChangeToIdsRefs({ op: 'replace', at: 1, count: 0, newCount: 2 }, ids, refs);
			expect(ids).toHaveLength(4);
			expect(ids[0]).toBe('a');
			expect(ids[3]).toBe('b');
		});

		it('replace with newCount=0 behaves like delete', () => {
			const ids = ['a', 'b', 'c'];
			const refs = [mockRef(), mockRef(), mockRef()];
			applyStructuralChangeToIdsRefs({ op: 'replace', at: 1, count: 1, newCount: 0 }, ids, refs);
			expect(ids).toEqual(['a', 'c']);
		});
	});
});
