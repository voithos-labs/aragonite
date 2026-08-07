import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { assignIds } from '../../block-id';
import { isGapSelection } from '../../undo/types';
import type { UndoEntry } from '../../undo/types';

function entryWith(selection: UndoEntry['selection']): UndoEntry {
	const snapshot = parse('para\n');
	return { snapshot, blockIds: assignIds(snapshot.children), selection };
}

describe('isGapSelection', () => {
	it('narrows a gap-carrying entry away from the anchor/focus arm', () => {
		const entry = entryWith({ gapCaret: { parentPath: [0], index: 1 } });

		expect(isGapSelection(entry.selection)).toBe(true);
		// The narrow is what lets a consumer read the gap at all; without it neither arm's
		// fields are reachable on the union.
		if (isGapSelection(entry.selection)) {
			expect(entry.selection.gapCaret).toEqual({ parentPath: [0], index: 1 });
		}
	});

	it('leaves an anchor/focus entry on the range arm', () => {
		const point = { path: [0], offset: 2 };
		const entry = entryWith({ anchor: point, focus: point });

		expect(isGapSelection(entry.selection)).toBe(false);
		if (!isGapSelection(entry.selection)) {
			expect(entry.selection.focus.offset).toBe(2);
		}
	});
});
