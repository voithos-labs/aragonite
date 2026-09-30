// @vitest-environment jsdom
// Every edge-dispatch branch that writes remembers the caret its write hands back, counted in the
// stored bytes, never the one it computed in the text it wrote: a kind's rule (a table cell
// escaping a free `|`) moves the caret, and only the write knows by how much.
// Miss-analysis: branches kept their own computed caret; no test's write moved the caret.
import { describe, expect, it } from 'vitest';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import type { BlockEditActions } from '$lib/action-contracts';
import type { CstNode } from '$lib/core/nodes';
import { withStoredCaret } from '$lib/editor-actions/stored-caret';
import { mountWidgetBlock } from './math-widget-fixture';
import {
	caretAfter,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountIslandBlock
} from './edge-policy-fixture';

/** How far the stand-in write moves every caret, as a rule inserting bytes ahead of it would. */
const SHIFT = 100;

function dispatchOver(node: CstNode, el: HTMLElement, hasIslands: boolean) {
	const parks: { offset: number | null; source: string }[] = [];
	const { dispatch } = makeEdgeDispatch(node, el, {
		hasIslands: () => hasIslands,
		blockEdit: {
			updateBlockContent: (_index, _text, _mode, before = 0, after = before) =>
				withStoredCaret(Promise.resolve(true), after + SHIFT)
		} as Pick<BlockEditActions, 'updateBlockContent'> as BlockEditActions,
		setPendingCursor: (offset, source) => parks.push({ offset, source })
	});
	return { dispatch, parks };
}

/** [prose][CST widget][prose], the shape a prose block renders. */
function mountWidget(source: string, kind: string) {
	const { node, el, widgets, inlineWidgets } = mountWidgetBlock(source, kind);
	return { ...dispatchOver(node, el, false), widget: inlineWidgets[0], island: widgets[0] };
}

/** A zero-width decoration widget at the block's end, with `onEdge: 'step-over'`. */
function mountIsland(source: string, at: number) {
	const { node, el, island } = mountIslandBlock(source, at);
	return { ...dispatchOver(node, el, true), island };
}

installEdgeDispatchCleanup();

describe('an edge-dispatch write parks the caret the write stored', () => {
	it('typing beside a CST widget', () => {
		const b = mountWidget('hello ![a](u) world', 'image');
		caretAfter(b.island);

		expect(b.dispatch.handleKeydown(key('z'), asRawOffset(b.widget.end))).toBe(true);
		expect(b.parks).toEqual([{ offset: b.widget.end + 1 + SHIFT, source: 'widget' }]);
	});

	it('typing beside a decoration widget', () => {
		const b = mountIsland('hello\n', 5);
		caretAfter(b.island);

		expect(b.dispatch.handleKeydown(key('z'), asRawOffset(5))).toBe(true);
		expect(b.parks).toEqual([{ offset: 6 + SHIFT, source: 'island' }]);
	});

	it('deleting through a decoration widget', () => {
		const b = mountIsland('hello\n', 5);
		caretAfter(b.island);

		expect(b.dispatch.handleKeydown(key('Backspace'), asRawOffset(5))).toBe(true);
		expect(b.parks).toEqual([{ offset: 4 + SHIFT, source: 'island' }]);
	});

	it('an atomic widget delete', () => {
		const b = mountWidget('a&copy;b', 'entityReference');

		expect(b.dispatch.handleKeydown(key('Backspace'), asRawOffset(b.widget.end))).toBe(true);
		expect(b.parks).toEqual([{ offset: b.widget.start + SHIFT, source: 'widget' }]);
	});
});
