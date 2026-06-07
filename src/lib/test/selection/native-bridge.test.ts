import { describe, it, expect } from 'vitest';
import { readCurrentSelection } from '../../selection/native-bridge';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { mockRef } from '../harness/editor-actions';

describe('readCurrentSelection — unfocused editor', () => {
	it('returns null when no block reports a cursor (does NOT clamp to block 0 offset 0)', () => {
		const selectionState = createSelectionState();
		const blockRefs = [
			mockRef({ getCursorOffset: () => null }),
			mockRef({ getCursorOffset: () => null }),
			mockRef({ getCursorOffset: () => null })
		];

		const result = readCurrentSelection(selectionState, blockRefs);

		expect(result).toBeNull();
	});

	it('returns the focused block caret when exactly one block reports an offset', () => {
		const selectionState = createSelectionState();
		const blockRefs = [
			mockRef({ getCursorOffset: () => null }),
			mockRef({ getCursorOffset: () => 7 }),
			mockRef({ getCursorOffset: () => null })
		];
		const result = readCurrentSelection(selectionState, blockRefs);
		expect(result).toEqual({
			anchor: { path: [1], offset: 7 },
			focus: { path: [1], offset: 7 }
		});
	});
});
