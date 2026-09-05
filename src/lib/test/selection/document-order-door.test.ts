// `normalizeSelection` as a consumer reaches it: the published name, from the package barrel.
// The ordering cases belong to the internal `normalize` in `selection-point.test.ts`; what only
// this layer can pin is the alias itself and the shape a hand-rolled comparison gets wrong.
import { describe, it, expect } from 'vitest';
import { normalizeSelection, type EditorSelection, type SelectionPoint } from '$lib';

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });
const range = (anchor: SelectionPoint, focus: SelectionPoint): EditorSelection => ({
	anchor,
	focus
});

describe('normalizeSelection', () => {
	// A container and a block inside it share every index the shorter path has, and the ancestor
	// is the earlier one — what an index-by-index comparison in host code gets wrong.
	it('puts a container ahead of a block nested inside it', () => {
		const container = at([1], 0);
		const child = at([1, 0], 4);
		expect(normalizeSelection(range(child, container)).start).toBe(container);
		expect(normalizeSelection(range(container, child)).end).toBe(child);
	});

	// What a null selection answers: nothing, by construction. `getSelection()` reports null with
	// nothing focused and at a gap caret, so the host branches before ordering. The compile-time
	// half is the load-bearing one; `npm run check` verifies the directive.
	it('cannot be handed the null getSelection reports', () => {
		const nothingFocused: EditorSelection | null = null;
		// @ts-expect-error — the helper takes a selection, so the null branch is the caller's
		void (() => normalizeSelection(nothingFocused));
		expect(nothingFocused ? normalizeSelection(nothingFocused) : null).toBeNull();
	});
});
