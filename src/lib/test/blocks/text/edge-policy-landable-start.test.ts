// @vitest-environment jsdom
// Backspace at the first offset the caret can sit at is a block gesture (merge, or nothing), so
// the destructive edge branch does nothing there, even with a hidden run such as an escape's
// backslash before it.
// Miss-analysis: GH #108, the branch's suite never pressed at the block's first reachable offset.
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

/** One live block whose DOM carries the marker spans the reachable-offset scan reads. */
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

/** `\*a\*` rendered live: the backslashes are hidden runs, so the first reachable offset is 1. */
const mountEscapes = () =>
	mount('\\*a\\*\n', [marker('\\'), text('*'), text('a'), marker('\\'), text('*')]);

installEdgeDispatchCleanup();

describe('the destructive branch at the block’s reachable start', () => {
	it('declines Backspace at the first reachable offset inside a leading escape', () => {
		const h = mountEscapes();
		expect(h.handleKeydown(key('Backspace'), at(1))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('still takes the escape whole one step past the first reachable offset', () => {
		const h = mountEscapes();
		expect(h.handleKeydown(key('Backspace'), at(2))).toBe(true);
		expect(h.edits).toEqual([[0, 'a\\*\n', 2, 0]]);
	});

	it('still claims Delete at the first reachable offset: forward is a construct edit', () => {
		const h = mountEscapes();
		expect(h.handleKeydown(key('Delete'), at(1))).toBe(true);
		expect(h.edits).toEqual([[0, 'a\\*\n', 1, 0]]);
	});
});
