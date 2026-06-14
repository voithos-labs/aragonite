import { describe, it, expect } from 'vitest';
import { createSelectionDescription } from '../../selection/selection-description';

describe('selection-description', () => {
	it('describes a cross-block selection by top-level block count', () => {
		const sel = { anchor: { path: [0], offset: 0 }, focus: { path: [2], offset: 3 } };
		expect(createSelectionDescription(sel)).toBe('Selected 3 blocks');
	});

	it('normalizes a reversed selection', () => {
		const sel = { anchor: { path: [3], offset: 0 }, focus: { path: [1], offset: 0 } };
		expect(createSelectionDescription(sel)).toBe('Selected 3 blocks');
	});

	it('returns empty for a single-block selection (handled natively)', () => {
		const sel = { anchor: { path: [1], offset: 0 }, focus: { path: [1], offset: 4 } };
		expect(createSelectionDescription(sel)).toBe('');
	});

	it('counts a cross-container selection by its top-level span', () => {
		const sel = { anchor: { path: [0, 0, 1], offset: 0 }, focus: { path: [2], offset: 0 } };
		expect(createSelectionDescription(sel)).toBe('Selected 3 blocks');
	});

	it('stays generic for a cross-block selection nested within one top-level block', () => {
		// Two items of the same top-level list — spans no top-level blocks, so a
		// count would read "Selected 1 blocks" and mislead.
		const sel = { anchor: { path: [2, 0], offset: 0 }, focus: { path: [2, 3], offset: 0 } };
		expect(createSelectionDescription(sel)).toBe('Selected text across blocks');
	});
});
