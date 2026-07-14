import { describe, it, expect } from 'vitest';
import * as pluginBarrel from '$lib/plugin';
import * as mainBarrel from '$lib/index';
import { SELECTION_END } from '$lib/block-component';
import type { EditorSelection, SelectionPoint } from '$lib/plugin';

// The selection-geometry surface is pre-freeze. This probe pins the sentinel on
// both barrels to its single mint (block-component), so a dropped re-export fails
// here rather than in a consumer that would otherwise hardcode MAX_SAFE_INTEGER.
describe('selection-geometry barrel surface', () => {
	it('re-exports SELECTION_END from block-component on both barrels', () => {
		expect(pluginBarrel.SELECTION_END).toBe(SELECTION_END);
		expect(mainBarrel.SELECTION_END).toBe(SELECTION_END);
	});

	it('exposes the selection endpoint types (compile-time contract)', () => {
		const point: SelectionPoint = { path: [0], offset: 3 };
		const selection: EditorSelection = { anchor: point, focus: point };
		expect(selection.focus.offset).toBe(3);
	});
});
