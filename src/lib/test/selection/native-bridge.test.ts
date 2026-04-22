import { describe, it, expect } from 'vitest';
import { readCurrentSelection } from '../../selection/native-bridge';
import { createSelectionState } from '../../selection/selection-state.svelte';

describe('readCurrentSelection — unfocused editor', () => {
	it('returns null when no block reports a cursor (does NOT clamp to block 0 offset 0)', () => {
		const selectionState = createSelectionState();
		const blockRefs = [
			{ getCursorOffset: () => null },
			{ getCursorOffset: () => null },
			{ getCursorOffset: () => null }
		];

		const buildCollapsed = (i: number, o: number) => ({
			anchor: { path: [i], offset: o },
			focus: { path: [i], offset: o }
		});

		const result = readCurrentSelection(selectionState, blockRefs, buildCollapsed);

		expect(result).toBeNull();
	});

	it('returns the focused block caret when exactly one block reports an offset', () => {
		const selectionState = createSelectionState();
		const blockRefs = [
			{ getCursorOffset: () => null },
			{ getCursorOffset: () => 7 },
			{ getCursorOffset: () => null }
		];
		const buildCollapsed = (i: number, o: number) => ({
			anchor: { path: [i], offset: o },
			focus: { path: [i], offset: o }
		});
		const result = readCurrentSelection(selectionState, blockRefs, buildCollapsed);
		expect(result).toEqual({
			anchor: { path: [1], offset: 7 },
			focus: { path: [1], offset: 7 }
		});
	});
});
