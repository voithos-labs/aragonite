// @vitest-environment jsdom
//
// Backspace at the block's landable start is a block gesture (merge or inert), so the
// destructive edge arm must stand down there: an atomic run straddling the start — an escape's
// hidden backslash — would otherwise turn the press into a forward delete of the first visible
// glyph (GH #108).
// Miss-analysis: the arm's suite drove presses beside and inside constructs but never AT the
// landable start, the one offset where the press belongs to the block, not the construct.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import {
	at,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountSurface,
	type EdgeDispatchHarness
} from './edge-policy-fixture';

/** One live block whose DOM carries the marker spans the landable walk reads. */
function mount(source: string, parts: Node[]): EdgeDispatchHarness {
	const node = parse(source).children[0];
	return makeEdgeDispatch(node, mountSurface(parts, 'live'));
}

function marker(text: string): HTMLElement {
	const el = document.createElement('span');
	el.className = 'md-marker';
	el.textContent = text;
	return el;
}

const text = (s: string) => document.createTextNode(s);

/** `\*a\*` rendered live: the backslashes are hidden runs, so the landable start is 1. */
const mountEscapes = () =>
	mount('\\*a\\*\n', [marker('\\'), text('*'), text('a'), marker('\\'), text('*')]);

installEdgeDispatchCleanup();

describe('the destructive arm at the block’s landable start', () => {
	it('declines Backspace at the landable start inside a leading escape', () => {
		const h = mountEscapes();
		expect(h.handleKeydown(key('Backspace'), at(1))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('still takes the escape whole one step past the landable start', () => {
		const h = mountEscapes();
		expect(h.handleKeydown(key('Backspace'), at(2))).toBe(true);
		expect(h.edits).toEqual([[0, 'a\\*\n', 2, 0]]);
	});

	it('still claims Delete at the landable start — forward is a construct edit', () => {
		const h = mountEscapes();
		expect(h.handleKeydown(key('Delete'), at(1))).toBe(true);
		expect(h.edits).toEqual([[0, 'a\\*\n', 1, 0]]);
	});
});
