import { describe, it, expect } from 'vitest';
import { createSelectionState } from '../../selection/selection-state.svelte';

const GAP = { parentPath: [0], index: 1 };

function stateWithEmissions() {
	let emissions = 0;
	const selection = createSelectionState({ onChange: () => (emissions += 1) });
	return {
		selection,
		get emissions() {
			return emissions;
		},
		resetEmissions: () => (emissions = 0)
	};
}

describe('SelectionState — the gap caret as a third mode', () => {
	it('starts with no gap', () => {
		expect(createSelectionState().gapCaret).toBeNull();
	});

	it('displaces a live cross-block pair in one emission', () => {
		const h = stateWithEmissions();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 4 });
		h.resetEmissions();

		h.selection.setGapCaret(GAP);

		expect(h.selection.gapCaret).toEqual(GAP);
		expect(h.selection.isCrossBlock).toBe(false);
		expect(h.selection.anchor).toBeNull();
		expect(h.emissions).toBe(1);
	});

	it('stores a defensive copy, so a caller mutating its own position cannot reach in', () => {
		const s = createSelectionState();
		const pos = { parentPath: [0], index: 1 };
		s.setGapCaret(pos);
		pos.parentPath.push(9);
		pos.index = 7;

		expect(s.gapCaret).toEqual({ parentPath: [0], index: 1 });
	});

	// The read side owes the same copy as the write side, or a consumer that edits what it
	// read back writes state with nobody notified.
	it('copies on read, so mutating the result cannot reach in either', () => {
		const h = stateWithEmissions();
		h.selection.setGapCaret(GAP);
		h.resetEmissions();

		const read = h.selection.gapCaret!;
		read.parentPath.push(9);
		read.index = 7;

		expect(h.selection.gapCaret).toEqual(GAP);
		expect(h.emissions).toBe(0);
	});

	it.each([
		[
			'enterCrossBlock',
			(s: ReturnType<typeof createSelectionState>) =>
				s.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 4 })
		],
		['collapse', (s: ReturnType<typeof createSelectionState>) => s.collapse()],
		['clear', (s: ReturnType<typeof createSelectionState>) => s.clear()]
	])('%s ends a live gap', (_label, act) => {
		const h = stateWithEmissions();
		h.selection.setGapCaret(GAP);
		h.resetEmissions();

		act(h.selection);

		expect(h.selection.gapCaret).toBeNull();
		expect(h.emissions).toBe(1);
	});

	it('clears an unset gap silently, so a bare caret placement stays a no-op', () => {
		const h = stateWithEmissions();

		h.selection.clearGapCaret();

		expect(h.selection.gapCaret).toBeNull();
		expect(h.emissions).toBe(0);
	});

	it('clears a live gap with one emission', () => {
		const h = stateWithEmissions();
		h.selection.setGapCaret(GAP);
		h.resetEmissions();

		h.selection.clearGapCaret();

		expect(h.selection.gapCaret).toBeNull();
		expect(h.emissions).toBe(1);
	});

	it('collapses a set-then-clear batch into one emission', () => {
		const h = stateWithEmissions();

		h.selection.batch(() => {
			h.selection.setGapCaret(GAP);
			h.selection.clearGapCaret();
		});

		expect(h.selection.gapCaret).toBeNull();
		expect(h.emissions).toBe(1);
	});
});
