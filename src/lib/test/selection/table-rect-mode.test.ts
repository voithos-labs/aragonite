import { describe, it, expect } from 'vitest';
import { selectionInTableMode } from '../../selection/table-rect-mode';
import type { EditorSelection, SelectionPoint } from '../../selection/primitives';

const P = (path: number[], offset: number): SelectionPoint => ({ path, offset });
const sel = (anchor: SelectionPoint, focus: SelectionPoint): EditorSelection => ({ anchor, focus });

describe('selectionInTableMode', () => {
	it('returns rectangular when both endpoints share a single-element path', () => {
		expect(selectionInTableMode(sel(P([2], 0), P([2], 5)))).toBe('rectangular');
	});

	it('returns linear when endpoints have differing single-element paths', () => {
		expect(selectionInTableMode(sel(P([1], 0), P([2], 0)))).toBe('linear');
	});

	it('returns rectangular when both endpoints share a deeper path', () => {
		expect(selectionInTableMode(sel(P([2, 0], 0), P([2, 0], 7)))).toBe('rectangular');
	});
});
