// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readCurrentSelection, applySelectionToDom } from '../../selection/native-bridge';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { parse } from '../../core/parser';
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

describe('undo selection snapshots — cellCoordinate round-trip', () => {
	const TABLE_LAST = 'para\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';

	it('readCurrentSelection preserves the flag on cross-block table endpoints', () => {
		const doc = parse(TABLE_LAST);
		const s = createSelectionState({ getDoc: () => doc });
		s.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2, cellCoordinate: true });

		const snap = readCurrentSelection(s, []);

		expect(snap?.focus).toEqual({ path: [1], offset: 2, cellCoordinate: true });
		expect(snap?.anchor).toEqual({ path: [0], offset: 1 });
	});

	it('applySelectionToDom restores a table endpoint that still row-snaps', () => {
		const doc = parse(TABLE_LAST);
		const s = createSelectionState({ getDoc: () => doc });
		s.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2, cellCoordinate: true });
		const snap = readCurrentSelection(s, [])!;

		const restored = createSelectionState({ getDoc: () => doc });
		applySelectionToDom(snap, restored, () => null);

		expect(restored.focus?.cellCoordinate).toBe(true);
		// The whole-row snap keys on the flag: the end endpoint snaps to the
		// row's last cell. A dropped flag skips the snap and leaves offset 2.
		expect(restored.end?.offset).toBe(3);
	});
});
