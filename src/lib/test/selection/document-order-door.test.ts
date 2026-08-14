// `normalizeSelection` as a consumer reaches it: from the package barrel, over the selection
// shapes a host toolbar actually anchors to. The internal `normalize` cases live in
// `selection-point.test.ts`; what this file pins is the published name and the shapes a toolbar
// meets, including the two a hand-rolled path comparison gets wrong.
import { describe, it, expect } from 'vitest';
import { normalizeSelection, type EditorSelection, type SelectionPoint } from '$lib';

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });
const cellAt = (path: number[], offset: number): SelectionPoint => ({
	path,
	offset,
	cellCoordinate: true
});
const range = (anchor: SelectionPoint, focus: SelectionPoint): EditorSelection => ({
	anchor,
	focus
});

describe('normalizeSelection', () => {
	it('orders a backward same-block range by offset', () => {
		const anchor = at([2], 9);
		const focus = at([2], 3);
		expect(normalizeSelection(range(anchor, focus))).toEqual({ start: focus, end: anchor });
	});

	it('orders a backward cross-block range by path', () => {
		const anchor = at([4], 0);
		const focus = at([1], 6);
		expect(normalizeSelection(range(anchor, focus))).toEqual({ start: focus, end: anchor });
	});

	// The case a shallow index-by-index comparison gets wrong: a container and a block inside it
	// share every index the shorter path has, and the ancestor is the earlier one.
	it('puts a container ahead of a block nested inside it', () => {
		const container = at([1], 0);
		const child = at([1, 0], 4);
		expect(normalizeSelection(range(child, container)).start).toBe(container);
		expect(normalizeSelection(range(container, child)).end).toBe(child);
	});

	// Intra-table endpoints share the table's path and carry row-major CELL indices, so the offset
	// tiebreak is what orders them — flagged (a rectangle the funnel marked) or not.
	it('orders intra-table endpoints by cell index, flagged or not', () => {
		const lo = cellAt([3], 1);
		const hi = cellAt([3], 5);
		expect(normalizeSelection(range(hi, lo))).toEqual({ start: lo, end: hi });
		expect(normalizeSelection(range(at([3], 5), at([3], 1)))).toEqual({
			start: at([3], 1),
			end: at([3], 5)
		});
	});

	it('leaves a collapsed caret alone, both endpoints the same point', () => {
		const caret = at([0], 7);
		const ordered = normalizeSelection(range(caret, caret));
		expect(ordered.start).toBe(caret);
		expect(ordered.end).toBe(caret);
	});

	// What a null selection answers: nothing, by construction. `getSelection()` reports null with
	// nothing focused and at a gap caret, and the host must branch on that before ordering.
	it('cannot be handed the null getSelection reports', () => {
		const nothingFocused: EditorSelection | null = null;
		// @ts-expect-error — the helper takes a selection, so the null branch is the caller's
		expect(() => normalizeSelection(nothingFocused)).toThrow();
	});
});
