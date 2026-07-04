// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { extendFocusToPreviousBlock } from '../../selection/keyboard-extend';
import { parse } from '../../core/parser';
import type { Document } from '../../core/nodes';

// Anchor the state cross-block up front so the leaf walk under test runs
// without a DOM caret; the element argument is only read on cross-block entry.
function stateAt(doc: Document, path: number[]) {
	const s = createSelectionState({ getDoc: () => doc });
	s.enterCrossBlock({ path: path.slice(), offset: 0 }, { path: path.slice(), offset: 0 });
	return s;
}

const el = () => document.createElement('div');

describe("extendFocusToPreviousBlock from a container's first leaf", () => {
	it('Shift+ArrowUp extends to the block ABOVE the container, not its last leaf', () => {
		const doc = parse('para\n\n> a\n>\n> b\n');
		const s = stateAt(doc, [1, 0]);
		expect(extendFocusToPreviousBlock(s, doc, el(), [1, 0], 'start')).toBe(true);
		expect(s.focus).toEqual({ path: [0], offset: 0 });
	});

	it('Shift+ArrowLeft extends to the END of the block above the container', () => {
		const doc = parse('para\n\n> a\n>\n> b\n');
		const s = stateAt(doc, [1, 0]);
		expect(extendFocusToPreviousBlock(s, doc, el(), [1, 0], 'end')).toBe(true);
		expect(s.focus).toEqual({ path: [0], offset: 4 });
	});

	it("reports no move from the document's first leaf", () => {
		const doc = parse('> a\n> b\n\npara\n');
		const s = stateAt(doc, [0, 0]);
		expect(extendFocusToPreviousBlock(s, doc, el(), [0, 0], 'end')).toBe(false);
	});

	it('skips a transparent-only container without ping-ponging between its leaves', () => {
		const doc = parse('x\n\n> ![a](u)\n>\n> ![b](v)\n');
		const s = stateAt(doc, [1, 1]);
		expect(extendFocusToPreviousBlock(s, doc, el(), [1, 1], 'start')).toBe(true);
		expect(s.focus).toEqual({ path: [0], offset: 0 });
	});
});
