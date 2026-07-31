// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { extendFocusToDocEdge } from '../../selection/keyboard-extend';
import { parse } from '../../core/parser';
import type { Document } from '../../core/nodes';

// Anchor cross-block up front so the doc-edge walk runs without a DOM caret; the
// element argument is only read on cross-block entry.
function stateAt(doc: Document, path: number[]) {
	const s = createSelectionState({ getDoc: () => doc });
	s.enterCrossBlock({ path: path.slice(), offset: 0 }, { path: path.slice(), offset: 0 });
	return s;
}

const el = () => document.createElement('div');

describe('extendFocusToDocEdge', () => {
	it("Ctrl+Shift+End extends to the END offset of the document's last leaf", () => {
		const doc = parse('alpha\n\nbeta\n\ngamma\n');
		const s = stateAt(doc, [1]);
		expect(extendFocusToDocEdge(s, doc, el(), [1], 'end')).toBe(true);
		expect(s.focus).toEqual({ path: [2], offset: 5 });
	});

	it("Ctrl+Shift+Home extends to the START of the document's first leaf", () => {
		const doc = parse('alpha\n\nbeta\n\ngamma\n');
		const s = stateAt(doc, [1]);
		expect(extendFocusToDocEdge(s, doc, el(), [1], 'start')).toBe(true);
		expect(s.focus).toEqual({ path: [0], offset: 0 });
	});

	// A doc-edge target that resolves back onto the anchor's own leaf is a same-path range the seam
	// refuses: it collapses rather than minting an invisible cross-block state.
	it('collapses when the edge resolves back onto the anchor leaf', () => {
		const doc = parse('alpha\n\nbeta\n');
		const s = stateAt(doc, [1]);
		expect(extendFocusToDocEdge(s, doc, el(), [1], 'end')).toBe(true);
		expect(s.isCrossBlock).toBe(false);
		expect(s.focus).toBeNull();
	});

	it('steps inward past a transparent edge leaf to the nearest text-bearing leaf', () => {
		const doc = parse('![img](u)\n\ntext\n\ntail\n');
		const s = stateAt(doc, [2]);
		expect(extendFocusToDocEdge(s, doc, el(), [2], 'start')).toBe(true);
		expect(s.focus).toEqual({ path: [1], offset: 0 });
	});
});
