import { describe, it, expect } from 'vitest';
import { createSelectionState } from '../../selection/selection-state.svelte';

describe('SelectionState lifecycle', () => {
	it('starts empty and reports not cross-block', () => {
		const s = createSelectionState();
		expect(s.isCrossBlock).toBe(false);
		expect(s.anchor).toBeNull();
		expect(s.focus).toBeNull();
		expect(s.dragStart).toBeNull();
	});

	it('enterCrossBlock populates anchor and focus', () => {
		const s = createSelectionState();
		s.enterCrossBlock({ path: [0], offset: 2 }, { path: [1], offset: 4 });
		expect(s.isCrossBlock).toBe(true);
		expect(s.anchor).toEqual({ path: [0], offset: 2 });
		expect(s.focus).toEqual({ path: [1], offset: 4 });
	});

	it('extendFocus moves focus while leaving anchor fixed', () => {
		const s = createSelectionState();
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
		s.extendFocus({ path: [2], offset: 3 });
		expect(s.anchor).toEqual({ path: [0], offset: 0 });
		expect(s.focus).toEqual({ path: [2], offset: 3 });
	});

	it('clear resets everything', () => {
		const s = createSelectionState();
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
		s.beginDrag({ path: [0], offset: 0 });
		s.clear();
		expect(s.isCrossBlock).toBe(false);
		expect(s.anchor).toBeNull();
		expect(s.focus).toBeNull();
		expect(s.dragStart).toBeNull();
	});

	it('start and end are normalized in document order', () => {
		const s = createSelectionState();
		s.enterCrossBlock({ path: [3], offset: 2 }, { path: [0], offset: 5 });
		expect(s.start).toEqual({ path: [0], offset: 5 });
		expect(s.end).toEqual({ path: [3], offset: 2 });
	});

	it('ctrl+a doubling counter tracks press count', () => {
		const s = createSelectionState();
		expect(s.selectAllCount).toBe(0);
		s.incrementSelectAllCount();
		expect(s.selectAllCount).toBe(1);
		s.incrementSelectAllCount();
		expect(s.selectAllCount).toBe(2);
		s.resetSelectAllCount();
		expect(s.selectAllCount).toBe(0);
	});
});
