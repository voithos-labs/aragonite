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
	it('narrows a gap-carrying entry away from the anchor/focus branch', () => {
		const entry = entryWith({ gapCaret: { parentPath: [0], index: 1 } });

		expect(isGapSelection(entry.selection)).toBe(true);
		// Only the narrowed type lets a consumer read either case's fields.
		if (isGapSelection(entry.selection)) {
			expect(entry.selection.gapCaret).toEqual({ parentPath: [0], index: 1 });
		}
	});

	it('leaves an anchor/focus entry on the range branch', () => {
		const point = { path: [0], offset: 2 };
		const entry = entryWith({ anchor: point, focus: point });

		expect(isGapSelection(entry.selection)).toBe(false);
		if (!isGapSelection(entry.selection)) {
			expect(entry.selection.focus.offset).toBe(2);
		}
	});
});
